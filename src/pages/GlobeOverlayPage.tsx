import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { feature } from 'topojson-client';
import countriesTopology from 'world-atlas/countries-110m.json';
import type { GeometryCollection, Topology } from 'topojson-specification';
import {
  clearGlobeSession,
  fetchGlobeCheckIns,
  parseGlobeConfig,
  submitGlobeCheckIn,
  type GlobeCheckIn,
  type GlobeConfig,
} from '../lib/globe';
import { connectTwitchCheckInChat } from '../lib/twitchChat';

const GLOBE_RADIUS = 1;
const DEFAULT_CAMERA_Z = 3.25;
const FOCUS_ROTATION_MS = 3_200;
const FOCUS_HOLD_MS = 900;
const FOCUS_RESUME_MS = 2_000;
const GLOBE_TILT_X = -0.28;
const INITIAL_GLOBE_YAW = -0.55;

interface GlobeMarkerLabel {
  element: HTMLDivElement;
  position: THREE.Vector3;
}

interface GlobeMarkerPosition {
  labelPosition: THREE.Vector3;
  surfacePosition: THREE.Vector3;
  tipPosition: THREE.Vector3;
}

interface GlobeLightSpot {
  count: number;
  latitude: number;
  longitude: number;
}

type GeoJsonPosition = [number, number];
type GeoJsonPolygon = GeoJsonPosition[][]; 
type GeoJsonMultiPolygon = GeoJsonPolygon[];

interface CountryBorderFeature {
  id?: string | number;
  properties?: {
    name?: string;
  };
  geometry?: {
    type?: string;
    coordinates?: GeoJsonPolygon | GeoJsonMultiPolygon;
  };
}

interface CountryBorderCollection {
  features?: CountryBorderFeature[];
}

const COUNTRY_BORDERS = feature(
  countriesTopology as unknown as Topology<{ countries: GeometryCollection }>,
  countriesTopology.objects.countries as GeometryCollection,
) as CountryBorderCollection;

function getFeatureKey(feature: CountryBorderFeature): string {
  return String(feature.id ?? feature.properties?.name ?? '');
}

function latLonToVector(latitude: number, longitude: number, radius: number): THREE.Vector3 {
  const latitudeRad = THREE.MathUtils.degToRad(latitude);
  const longitudeRad = THREE.MathUtils.degToRad(longitude);
  const radiusAtLatitude = radius * Math.cos(latitudeRad);

  return new THREE.Vector3(
    radiusAtLatitude * Math.sin(longitudeRad),
    radius * Math.sin(latitudeRad),
    radiusAtLatitude * Math.cos(longitudeRad),
  );
}

function getMarkerPosition(latitude: number, longitude: number): GlobeMarkerPosition {
  return {
    labelPosition: latLonToVector(latitude, longitude, GLOBE_RADIUS * 1.145),
    surfacePosition: latLonToVector(latitude, longitude, GLOBE_RADIUS * 1.02),
    tipPosition: latLonToVector(latitude, longitude, GLOBE_RADIUS * 1.12),
  };
}

function easeInOutCubic(value: number): number {
  const clampedValue = THREE.MathUtils.clamp(value, 0, 1);

  return clampedValue * clampedValue * clampedValue * (
    clampedValue * (clampedValue * 6 - 15) + 10
  );
}

function createGlobeOrientation(yaw: number): THREE.Quaternion {
  return new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(GLOBE_TILT_X, yaw, 0, 'YXZ'));
}

function getYawFromGlobeOrientation(quaternion: THREE.Quaternion): number {
  return new THREE.Euler().setFromQuaternion(quaternion, 'YXZ').y;
}

function getFocusQuaternionForLocation(latitude: number, longitude: number): THREE.Quaternion {
  const targetPosition = latLonToVector(latitude, longitude, GLOBE_RADIUS).normalize();

  return new THREE.Quaternion().setFromUnitVectors(
    targetPosition,
    new THREE.Vector3(0, 0, 1),
  );
}

function isPointInRing(longitude: number, latitude: number, ring: GeoJsonPosition[]): boolean {
  let inside = false;

  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index++) {
    const [currentLongitude, currentLatitude] = ring[index];
    const [previousLongitude, previousLatitude] = ring[previousIndex];
    const intersects =
      currentLatitude > latitude !== previousLatitude > latitude &&
      longitude <
        ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
          (previousLatitude - currentLatitude) +
          currentLongitude;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function isPointInPolygon(
  longitude: number,
  latitude: number,
  polygon: GeoJsonPolygon,
): boolean {
  const outerRing = polygon[0];

  if (!outerRing || !isPointInRing(longitude, latitude, outerRing)) {
    return false;
  }

  return polygon
    .slice(1)
    .every((innerRing) => !isPointInRing(longitude, latitude, innerRing));
}

function findCountryKeyForLocation(
  latitude: number,
  longitude: number,
): string | null {
  for (const countryFeature of COUNTRY_BORDERS.features ?? []) {
    const geometry = countryFeature.geometry;

    if (!geometry?.coordinates) {
      continue;
    }

    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates as GeoJsonPolygon]
        : geometry.type === 'MultiPolygon'
          ? (geometry.coordinates as GeoJsonMultiPolygon)
          : [];

    if (polygons.some((polygon) => isPointInPolygon(longitude, latitude, polygon))) {
      return getFeatureKey(countryFeature);
    }
  }

  return null;
}

function createBorderLineFromRing(
  ring: GeoJsonPosition[],
  material: THREE.ShaderMaterial,
): THREE.Line | null {
  const points: THREE.Vector3[] = [];

  for (let index = 0; index < ring.length; index += 1) {
    const [longitude, latitude] = ring[index];
    const previous = ring[index - 1];

    if (previous && Math.abs(longitude - previous[0]) > 180) {
      continue;
    }

    points.push(latLonToVector(latitude, longitude, GLOBE_RADIUS * 1.012));
  }

  if (points.length < 2) {
    return null;
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, material);
}

function createCountryBorderMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying float vFacing;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec3 globeCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 normalDirection = normalize(worldPosition.xyz - globeCenter);
        vec3 viewDirection = normalize(cameraPosition - worldPosition.xyz);
        vFacing = dot(normalDirection, viewDirection);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying float vFacing;

      void main() {
        if (vFacing <= 0.0) {
          discard;
        }

        float alpha = smoothstep(0.02, 0.2, vFacing) * 0.82;
        gl_FragColor = vec4(0.56, 0.86, 1.0, alpha);
      }
    `,
  });
}

function createActiveCountryBorderMaterial(
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.ShaderMaterial {
  const activeColor = new THREE.Color(color);

  return new THREE.ShaderMaterial({
    uniforms: {
      borderColor: { value: activeColor },
      opacity: { value: opacity },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying float vFacing;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec3 globeCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 normalDirection = normalize(worldPosition.xyz - globeCenter);
        vec3 viewDirection = normalize(cameraPosition - worldPosition.xyz);
        vFacing = dot(normalDirection, viewDirection);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 borderColor;
      uniform float opacity;
      varying float vFacing;

      void main() {
        if (vFacing <= 0.0) {
          discard;
        }

        float alpha = smoothstep(0.02, 0.2, vFacing) * opacity;
        gl_FragColor = vec4(borderColor, alpha);
      }
    `,
  });
}

function createCountryFillMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
      varying float vFacing;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec3 globeCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 normalDirection = normalize(worldPosition.xyz - globeCenter);
        vec3 viewDirection = normalize(cameraPosition - worldPosition.xyz);
        vFacing = dot(normalDirection, viewDirection);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying float vFacing;

      void main() {
        if (vFacing <= 0.0) {
          discard;
        }

        float alpha = smoothstep(0.02, 0.18, vFacing) * 0.10;
        gl_FragColor = vec4(0.20, 0.58, 1.0, alpha);
      }
    `,
  });
}

function getLocationClusterKey(checkIn: GlobeCheckIn): string {
  return `${Math.round(checkIn.latitude * 10) / 10}:${Math.round(checkIn.longitude * 10) / 10}`;
}

function buildLightSpots(checkIns: GlobeCheckIn[]): GlobeLightSpot[] {
  const spotsByLocation = new Map<string, GlobeLightSpot>();

  for (const checkIn of checkIns) {
    const key = getLocationClusterKey(checkIn);
    const existingSpot = spotsByLocation.get(key);

    if (existingSpot) {
      existingSpot.count += 1;
    } else {
      spotsByLocation.set(key, {
        count: 1,
        latitude: checkIn.latitude,
        longitude: checkIn.longitude,
      });
    }
  }

  return Array.from(spotsByLocation.values());
}

function createSpotLightSprite(count: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 60);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.32)');
  gradient.addColorStop(0.2, 'rgba(160, 212, 255, 0.2)');
  gradient.addColorStop(0.48, 'rgba(70, 166, 255, 0.08)');
  gradient.addColorStop(1, 'rgba(70, 166, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: Math.min(0.6, 0.18 + count * 0.055),
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(Math.min(0.32, 0.105 + count * 0.018));
  return sprite;
}

function disposeSprite(sprite: THREE.Sprite): void {
  const material = sprite.material as THREE.SpriteMaterial;
  material.map?.dispose();
  material.dispose();
}

function createCountryFillMeshFromPolygon(
  polygon: GeoJsonPolygon,
  material: THREE.ShaderMaterial,
): THREE.Mesh | null {
  const outerRing = polygon[0]?.slice(0, -1) ?? [];

  if (outerRing.length < 3) {
    return null;
  }

  for (let index = 1; index < outerRing.length; index += 1) {
    if (Math.abs(outerRing[index][0] - outerRing[index - 1][0]) > 180) {
      return null;
    }
  }

  const contour = outerRing.map(
    ([longitude, latitude]) => new THREE.Vector2(longitude, latitude),
  );
  const holes = polygon
    .slice(1)
    .map((ring) =>
      ring
        .slice(0, -1)
        .map(([longitude, latitude]) => new THREE.Vector2(longitude, latitude)),
    )
    .filter((ring) => ring.length >= 3);
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
  const allRings = [outerRing, ...polygon.slice(1).map((ring) => ring.slice(0, -1))];
  const positions = allRings.flat();

  if (!triangles.length || positions.length < 3) {
    return null;
  }

  const vertices = new Float32Array(positions.length * 3);

  positions.forEach(([longitude, latitude], index) => {
    const vertex = latLonToVector(latitude, longitude, GLOBE_RADIUS * 1.001);
    vertices[index * 3] = vertex.x;
    vertices[index * 3 + 1] = vertex.y;
    vertices[index * 3 + 2] = vertex.z;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(triangles.flat());

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

function addCountryFills(
  fillGroup: THREE.Group,
  highlightedCountryKeys: Set<string>,
): void {
  if (!highlightedCountryKeys.size) {
    return;
  }

  const material = createCountryFillMaterial();

  for (const feature of COUNTRY_BORDERS.features ?? []) {
    if (!highlightedCountryKeys.has(getFeatureKey(feature))) {
      continue;
    }

    const geometry = feature.geometry;

    if (!geometry?.coordinates) {
      continue;
    }

    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates as GeoJsonPolygon]
        : geometry.type === 'MultiPolygon'
          ? (geometry.coordinates as GeoJsonMultiPolygon)
          : [];

    for (const polygon of polygons) {
      const fillMesh = createCountryFillMeshFromPolygon(polygon, material);

      if (fillMesh) {
        fillGroup.add(fillMesh);
      }
    }
  }
}

function addCountryBorders(
  borderGroup: THREE.Group,
  borderData: CountryBorderCollection,
): void {
  const material = createCountryBorderMaterial();

  for (const feature of borderData.features ?? []) {
    const geometry = feature.geometry;

    if (!geometry?.coordinates) {
      continue;
    }

    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates as GeoJsonPolygon]
        : geometry.type === 'MultiPolygon'
          ? (geometry.coordinates as GeoJsonMultiPolygon)
          : [];

    for (const polygon of polygons) {
      const outerRing = polygon[0];

      if (!outerRing) {
        continue;
      }

      const line = createBorderLineFromRing(outerRing, material);

      if (line) {
        borderGroup.add(line);
      }
    }
  }
}

function addActiveCountryBorders(
  activeCountryBorderGroup: THREE.Group,
  highlightedCountryKeys: Set<string>,
): void {
  if (!highlightedCountryKeys.size) {
    return;
  }

  const outerMaterial = createActiveCountryBorderMaterial(0x2f9dff, 0.68);
  const innerMaterial = createActiveCountryBorderMaterial(0xf2fbff, 1);

  for (const countryKey of highlightedCountryKeys) {
    const feature = (COUNTRY_BORDERS.features ?? []).find(
      (candidate) => getFeatureKey(candidate) === countryKey,
    );

    if (!feature?.geometry?.coordinates) {
      continue;
    }

    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates as GeoJsonPolygon]
        : feature.geometry.type === 'MultiPolygon'
          ? (feature.geometry.coordinates as GeoJsonMultiPolygon)
          : [];

    for (const polygon of polygons) {
      const outerRing = polygon[0];

      if (!outerRing) {
        continue;
      }

      const outerLine = createBorderLineFromRing(outerRing, outerMaterial);
      const innerLine = createBorderLineFromRing(outerRing, innerMaterial);

      if (outerLine) {
        outerLine.scale.setScalar(1.006);
        activeCountryBorderGroup.add(outerLine);
      }

      if (innerLine) {
        innerLine.scale.setScalar(1.012);
        activeCountryBorderGroup.add(innerLine);
      }
    }
  }
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };

    mesh.geometry?.dispose();

    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) => material.dispose());
    } else {
      mesh.material?.dispose();
    }
  });
}

export function GlobeScene({
  checkIns,
  config,
  className = '',
  focusCheckIn = null,
  onFocusMarkerPlace,
  onFocusComplete,
}: {
  checkIns: GlobeCheckIn[];
  config: GlobeConfig;
  className?: string;
  focusCheckIn?: { checkIn: GlobeCheckIn; requestId: number } | null;
  onFocusMarkerPlace?: (checkIn: GlobeCheckIn) => void;
  onFocusComplete?: (checkIn: GlobeCheckIn) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<GlobeMarkerLabel[]>([]);
  const markerGroupRef = useRef<THREE.Group | null>(null);
  const fillGroupRef = useRef<THREE.Group | null>(null);
  const activeCountryBorderGroupRef = useRef<THREE.Group | null>(null);
  const globeGroupRef = useRef<THREE.Group | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const focusAnimationRef = useRef<{
    checkIn: GlobeCheckIn;
    markerPlaced: boolean;
    resumeQuaternion: THREE.Quaternion;
    startedAt: number;
    startQuaternion: THREE.Quaternion;
    targetQuaternion: THREE.Quaternion;
  } | null>(null);
  const placedFocusKeyRef = useRef<string | null>(null);
  const rotationSpeedRef = useRef(config.rotationSpeed);
  const showLabelsRef = useRef(config.showLabels);
  const onFocusMarkerPlaceRef = useRef(onFocusMarkerPlace);
  const onFocusCompleteRef = useRef(onFocusComplete);

  useEffect(() => {
    rotationSpeedRef.current = config.rotationSpeed;
    showLabelsRef.current = config.showLabels;
  }, [config.rotationSpeed, config.showLabels]);

  useEffect(() => {
    onFocusMarkerPlaceRef.current = onFocusMarkerPlace;
    onFocusCompleteRef.current = onFocusComplete;
  }, [onFocusComplete, onFocusMarkerPlace]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const sceneContainer = container;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 100);
    camera.position.set(0, 0.08, DEFAULT_CAMERA_Z);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    rendererRef.current = renderer;
    sceneContainer.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0x8ebaff, 1.35);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(3, 2, 4);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xffc46b, 1.4);
    rimLight.position.set(-4, -1, 2);
    scene.add(rimLight);

    const globeGroup = new THREE.Group();
    globeGroup.quaternion.copy(createGlobeOrientation(INITIAL_GLOBE_YAW));
    scene.add(globeGroup);
    globeGroupRef.current = globeGroup;

    const fillGroup = new THREE.Group();
    globeGroup.add(fillGroup);
    fillGroupRef.current = fillGroup;

    const borderGroup = new THREE.Group();
    globeGroup.add(borderGroup);

    const activeCountryBorderGroup = new THREE.Group();
    globeGroup.add(activeCountryBorderGroup);
    activeCountryBorderGroupRef.current = activeCountryBorderGroup;

    const markerGroup = new THREE.Group();
    globeGroup.add(markerGroup);
    markerGroupRef.current = markerGroup;

    addCountryBorders(borderGroup, COUNTRY_BORDERS);

    function resize() {
      const width = sceneContainer.clientWidth || window.innerWidth;
      const height = sceneContainer.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    }

    function renderFrame() {
      const focusAnimation = focusAnimationRef.current;

      if (focusAnimation) {
        const elapsed = performance.now() - focusAnimation.startedAt;
        const totalDuration = FOCUS_ROTATION_MS + FOCUS_HOLD_MS + FOCUS_RESUME_MS;

        if (elapsed <= FOCUS_ROTATION_MS) {
          const progress = easeInOutCubic(elapsed / FOCUS_ROTATION_MS);
          globeGroup.quaternion.slerpQuaternions(
            focusAnimation.startQuaternion,
            focusAnimation.targetQuaternion,
            progress,
          );
          camera.position.z = DEFAULT_CAMERA_Z;
        } else if (elapsed <= FOCUS_ROTATION_MS + FOCUS_HOLD_MS) {
          globeGroup.quaternion.copy(focusAnimation.targetQuaternion);
          camera.position.z = DEFAULT_CAMERA_Z;

          if (!focusAnimation.markerPlaced) {
            focusAnimation.markerPlaced = true;
            onFocusMarkerPlaceRef.current?.(focusAnimation.checkIn);
          }
        } else if (elapsed <= totalDuration) {
          const progress = easeInOutCubic(
            (elapsed - FOCUS_ROTATION_MS - FOCUS_HOLD_MS) / FOCUS_RESUME_MS,
          );
          globeGroup.quaternion.slerpQuaternions(
            focusAnimation.targetQuaternion,
            focusAnimation.resumeQuaternion,
            progress,
          );
          camera.position.z = DEFAULT_CAMERA_Z;
        } else {
          if (!focusAnimation.markerPlaced) {
            focusAnimation.markerPlaced = true;
            onFocusMarkerPlaceRef.current?.(focusAnimation.checkIn);
          }

          camera.position.z = DEFAULT_CAMERA_Z;
          globeGroup.quaternion.copy(focusAnimation.resumeQuaternion);
          focusAnimationRef.current = null;
          onFocusCompleteRef.current?.(focusAnimation.checkIn);
        }
      } else {
        globeGroup.quaternion.copy(
          createGlobeOrientation(
            getYawFromGlobeOrientation(globeGroup.quaternion) +
              rotationSpeedRef.current * 0.01,
          ),
        );
      }

      globeGroup.updateMatrixWorld();

      const rendererSize = renderer.getSize(new THREE.Vector2());

      for (const label of labelsRef.current) {
        const worldPosition = label.position.clone().applyMatrix4(globeGroup.matrixWorld);
        const projected = worldPosition.clone().project(camera);
        const visible = showLabelsRef.current && worldPosition.z > -0.08;
        label.element.style.opacity = visible ? '1' : '0';
        label.element.style.transform = `translate3d(${
          (projected.x * 0.5 + 0.5) * rendererSize.x
        }px, ${(-projected.y * 0.5 + 0.5) * rendererSize.y}px, 0)`;
      }

      renderer.render(scene, camera);
      animationFrameId = window.requestAnimationFrame(renderFrame);
    }

    let animationFrameId = window.requestAnimationFrame(renderFrame);
    resize();
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
      labelsRef.current.forEach((label) => label.element.remove());
      labelsRef.current = [];
      renderer.dispose();
      disposeGroup(fillGroup);
      disposeGroup(borderGroup);
      disposeGroup(activeCountryBorderGroup);
      fillGroupRef.current = null;
      activeCountryBorderGroupRef.current = null;
      sceneContainer.removeChild(renderer.domElement);
    };
  }, []);

  useEffect(() => {
    const fillGroup = fillGroupRef.current;
    const activeCountryBorderGroup = activeCountryBorderGroupRef.current;

    if (!fillGroup || !activeCountryBorderGroup) {
      return;
    }

    const highlightedCountryKeys = new Set<string>();

    for (const checkIn of checkIns) {
      const countryKey = findCountryKeyForLocation(
        checkIn.latitude,
        checkIn.longitude,
      );

      if (countryKey) {
        highlightedCountryKeys.add(countryKey);
      }
    }

    disposeGroup(fillGroup);
    fillGroup.clear();
    addCountryFills(fillGroup, highlightedCountryKeys);
    disposeGroup(activeCountryBorderGroup);
    activeCountryBorderGroup.clear();
    addActiveCountryBorders(activeCountryBorderGroup, highlightedCountryKeys);
  }, [checkIns]);

  useEffect(() => {
    const globeGroup = globeGroupRef.current;
    const camera = cameraRef.current;

    if (!focusCheckIn || !globeGroup || !camera) {
      return;
    }

    const focusKey = String(focusCheckIn.requestId);

    if (placedFocusKeyRef.current === focusKey) {
      return;
    }

    placedFocusKeyRef.current = focusKey;
    const totalFocusDuration = FOCUS_ROTATION_MS + FOCUS_HOLD_MS + FOCUS_RESUME_MS;
    const startYaw = getYawFromGlobeOrientation(globeGroup.quaternion);
    const defaultRotationDuringFocus =
      rotationSpeedRef.current * 0.01 * (totalFocusDuration / (1000 / 60));
    const resumeQuaternion = createGlobeOrientation(startYaw + defaultRotationDuringFocus);
    const targetQuaternion = getFocusQuaternionForLocation(
      focusCheckIn.checkIn.latitude,
      focusCheckIn.checkIn.longitude,
    );

    focusAnimationRef.current = {
      checkIn: focusCheckIn.checkIn,
      markerPlaced: false,
      resumeQuaternion,
      startedAt: performance.now(),
      startQuaternion: globeGroup.quaternion.clone(),
      targetQuaternion,
    };
  }, [focusCheckIn]);

  useEffect(() => {
    const container = containerRef.current;
    const markerGroup = markerGroupRef.current;

    if (!container || !markerGroup) {
      return;
    }

    markerGroup.clear();
    labelsRef.current.forEach((label) => label.element.remove());
    labelsRef.current = [];

    const markerMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.45,
      roughness: 0.35,
    });
    const markerHeadGeometry = new THREE.SphereGeometry(0.008, 16, 16);
    const markerStemGeometry = new THREE.CylinderGeometry(0.0015, 0.003, 0.1, 10);

    for (const lightSpot of buildLightSpots(checkIns)) {
      const spotLight = createSpotLightSprite(lightSpot.count);
      spotLight.position.copy(
        latLonToVector(lightSpot.latitude, lightSpot.longitude, GLOBE_RADIUS * 1.02),
      );
      markerGroup.add(spotLight);
    }

    for (const checkIn of checkIns) {
      const { labelPosition, surfacePosition, tipPosition } = getMarkerPosition(
        checkIn.latitude,
        checkIn.longitude,
      );
      const marker = new THREE.Mesh(markerHeadGeometry, markerMaterial);
      marker.position.copy(tipPosition);
      markerGroup.add(marker);

      const stem = new THREE.Mesh(markerStemGeometry, markerMaterial);
      const stemPosition = surfacePosition.clone().lerp(tipPosition, 0.5);
      stem.position.copy(stemPosition);
      stem.lookAt(new THREE.Vector3(0, 0, 0));
      stem.rotateX(Math.PI / 2);
      markerGroup.add(stem);

      const label = document.createElement('div');
      label.className = 'globe-marker-label';
      label.textContent = checkIn.viewerName;
      container.appendChild(label);
      labelsRef.current.push({
        element: label,
        position: labelPosition,
      });
    }

    return () => {
      markerGroup.traverse((object) => {
        if (object instanceof THREE.Sprite) {
          disposeSprite(object);
        }
      });
      markerHeadGeometry.dispose();
      markerStemGeometry.dispose();
      markerMaterial.dispose();
    };
  }, [checkIns]);

  return <div ref={containerRef} className={`globe-canvas ${className}`.trim()} />;
}

function upsertCheckIn(checkIns: GlobeCheckIn[], nextCheckIn: GlobeCheckIn): GlobeCheckIn[] {
  const withoutExisting = checkIns.filter(
    (checkIn) => checkIn.viewerName.toLowerCase() !== nextCheckIn.viewerName.toLowerCase(),
  );

  return [nextCheckIn, ...withoutExisting].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function GlobeOverlayPage() {
  const config = useMemo(() => parseGlobeConfig(window.location.search), []);
  const [checkIns, setCheckIns] = useState<GlobeCheckIn[]>([]);
  const [focusCheckIn, setFocusCheckIn] = useState<{
    checkIn: GlobeCheckIn;
    requestId: number;
  } | null>(null);
  const [status, setStatus] = useState('Starting globe');
  const checkInsRef = useRef<GlobeCheckIn[]>([]);
  const pendingLocationsRef = useRef(new Set<string>());
  const focusRequestIdRef = useRef(0);

  useEffect(() => {
    checkInsRef.current = checkIns;
  }, [checkIns]);

  function focusExistingCheckIn(checkIn: GlobeCheckIn) {
    focusRequestIdRef.current += 1;
    setFocusCheckIn({
      checkIn,
      requestId: focusRequestIdRef.current,
    });
  }

  function resetGlobeSession() {
    setFocusCheckIn(null);
    setCheckIns([]);
    pendingLocationsRef.current.clear();

    void clearGlobeSession(config.sessionId).catch(() => {
      setStatus('Unable to reset globe markers.');
    });
  }

  useEffect(() => {
    document.body.classList.toggle('globe-transparent-shell', config.transparent);

    return () => {
      document.body.classList.remove('globe-transparent-shell');
    };
  }, [config.transparent]);

  useEffect(() => {
    const controller = new AbortController();

    void fetchGlobeCheckIns(config.sessionId, controller.signal)
      .then((loadedCheckIns) => {
        setCheckIns(loadedCheckIns.sort((a, b) => b.updatedAt - a.updatedAt));
      })
      .catch(() => setStatus('Unable to load saved check-ins.'));

    return () => controller.abort();
  }, [config.sessionId]);

  useEffect(() => {
    return connectTwitchCheckInChat({
      channel: config.channel,
      onStatus: setStatus,
      onReset() {
        resetGlobeSession();
      },
      onCheckIn(command) {
        if (command.locationQuery.trim().toLowerCase() === 'me') {
          const existingCheckIn = checkInsRef.current.find(
            (checkIn) =>
              checkIn.viewerName.toLowerCase() === command.viewerName.toLowerCase(),
          );

          if (existingCheckIn) {
            focusExistingCheckIn(existingCheckIn);
          }

          return;
        }

        const pendingKey = `${command.viewerName.toLowerCase()}|${command.locationQuery.toLowerCase()}`;

        if (pendingLocationsRef.current.has(pendingKey)) {
          return;
        }

        pendingLocationsRef.current.add(pendingKey);

        void submitGlobeCheckIn(
          config.sessionId,
          command.viewerName,
          command.locationQuery,
        )
          .then((checkIn) => {
            if (!checkIn) {
              return;
            }

            focusExistingCheckIn(checkIn);
          })
          .catch(() => undefined)
          .finally(() => {
            pendingLocationsRef.current.delete(pendingKey);
          });
      },
    });
  }, [config.channel, config.sessionId]);

  return (
    <main className={config.transparent ? 'globe-overlay is-transparent' : 'globe-overlay'}>
      <GlobeScene
        checkIns={checkIns}
        config={config}
        focusCheckIn={focusCheckIn}
        onFocusMarkerPlace={(checkIn) => {
          setCheckIns((current) => upsertCheckIn(current, checkIn));
        }}
        onFocusComplete={(checkIn) => {
          setFocusCheckIn((current) =>
            current?.checkIn.id === checkIn.id &&
            current.checkIn.updatedAt === checkIn.updatedAt
              ? null
              : current,
          );
        }}
      />
      <span className="sr-only">{status}</span>
    </main>
  );
}
