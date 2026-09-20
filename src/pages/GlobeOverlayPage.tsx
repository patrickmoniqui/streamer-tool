import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { feature } from 'topojson-client';
import countriesTopology from 'world-atlas/countries-110m.json';
import landTopology from 'world-atlas/land-110m.json';
import type { GeometryCollection, Topology } from 'topojson-specification';
import {
  clearGlobeSession,
  fetchGlobeCheckIns,
  getGlobeRotationsPerSecond,
  parseGlobeConfig,
  submitGlobeCheckIn,
  type GlobeCheckIn,
  type GlobeConfig,
} from '../lib/globe';
import { connectTwitchCheckInChat } from '../lib/twitchChat';

const GLOBE_RADIUS = 1;
const GLOBE_FILL_RADIUS = GLOBE_RADIUS * 0.999;
const GLOBE_OCCLUSION_RADIUS = GLOBE_FILL_RADIUS * 0.9995;
const MAX_FILL_TRIANGLE_EDGE_DEGREES = 3;
const MAX_FILL_SUBDIVISION_DEPTH = 6;
const BASE_CAMERA_Z = 3.25;
const MARKER_LABEL_RADIUS = 1.145;
const MARKER_ENVELOPE_VIEWPORT_HEIGHT = 0.8;
const DEFAULT_CAMERA_Z =
  (BASE_CAMERA_Z * MARKER_LABEL_RADIUS) / MARKER_ENVELOPE_VIEWPORT_HEIGHT;
const FOCUS_ROTATION_MS = 3_200;
const FOCUS_HOLD_MS = 900;
const FOCUS_RESUME_MS = 2_000;
const GLOBE_TILT_X = 0;
const INITIAL_GLOBE_YAW = -0.55;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOCAL_CHECK_IN_REFRESH_MS = 1_000;
let hiddenCountryBorderOpacity = 0.1;

interface GlobeMarkerVisual {
  element?: HTMLDivElement;
  labelOffsetX?: number;
  labelOffsetY?: number;
  labelPosition?: THREE.Vector3;
  objects: THREE.Object3D[];
  surfacePosition: THREE.Vector3;
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

interface GlobeThemeColors {
  activeOuter: THREE.Color;
  activeInner: THREE.Color;
  border: THREE.Color;
  fill: THREE.Color;
  marker: THREE.Color;
  spotCore: string;
  spotMid: string;
  spotOuter: string;
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

// This topology has national boundaries dissolved, leaving coastlines and the
// general outline of continents and islands for the base globe map.
const LANDMASSES = feature(
  landTopology as unknown as Topology<{ land: GeometryCollection }>,
  landTopology.objects.land as GeometryCollection,
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

function createGlobeOrientation(
  yaw: number,
  tiltX = GLOBE_TILT_X,
  tiltZ = 0,
): THREE.Quaternion {
  return new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ, 'YXZ'));
}

function getYawFromGlobeOrientation(quaternion: THREE.Quaternion): number {
  return new THREE.Euler().setFromQuaternion(quaternion, 'YXZ').y;
}

function formatVector(vector: THREE.Vector3): string {
  return `x ${vector.x.toFixed(3)}  y ${vector.y.toFixed(3)}  z ${vector.z.toFixed(3)}`;
}

function formatRotation(rotation: THREE.Euler): string {
  return `x ${THREE.MathUtils.radToDeg(rotation.x).toFixed(1)}°  y ${THREE.MathUtils.radToDeg(
    rotation.y,
  ).toFixed(1)}°  z ${THREE.MathUtils.radToDeg(rotation.z).toFixed(1)}°`;
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

function formatRgba(color: THREE.Color, alpha: number): string {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha})`;
}

function getGlobeThemeColors(globeColor: string): GlobeThemeColors {
  const baseColor = new THREE.Color(globeColor);
  const border = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.22);
  const fill = baseColor.clone().offsetHSL(0, 0.03, -0.1);
  const marker = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.34);
  const activeOuter = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.12);
  const activeInner = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.82);
  const spotMid = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.2);
  const spotOuter = baseColor.clone();

  return {
    activeOuter,
    activeInner,
    border,
    fill,
    marker,
    spotCore: formatRgba(new THREE.Color(0xffffff), 0.32),
    spotMid: formatRgba(spotMid, 0.2),
    spotOuter: formatRgba(spotOuter, 0.08),
  };
}

function createCountryBorderMaterial(
  borderColor: THREE.ColorRepresentation,
): THREE.ShaderMaterial {
  const color = new THREE.Color(borderColor);

  return new THREE.ShaderMaterial({
    uniforms: {
      borderColor: { value: color },
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
      varying float vFacing;

      void main() {
        float visibility = mix(0.1, 1.0, smoothstep(0.0, 0.2, vFacing));
        float alpha = visibility * 0.82;
        gl_FragColor = vec4(borderColor, alpha);
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
        float visibility = mix(0.1, 1.0, smoothstep(0.0, 0.2, vFacing));
        float alpha = visibility * opacity;
        gl_FragColor = vec4(borderColor, alpha);
      }
    `,
  });
}

function createLandmassFillMaterial(
  fillColor: THREE.ColorRepresentation,
): THREE.ShaderMaterial {
  const color = new THREE.Color(fillColor);

  return new THREE.ShaderMaterial({
    uniforms: {
      fillColor: { value: color },
    },
    transparent: true,
    depthTest: true,
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
      uniform vec3 fillColor;
      varying float vFacing;

      void main() {
        if (vFacing <= 0.0) {
          discard;
        }

        float visibility = smoothstep(0.06, 0.34, vFacing);
        float alpha = visibility * 0.20;
        vec3 shadedColor = mix(fillColor * 0.34, fillColor * 0.78, visibility);
        gl_FragColor = vec4(shadedColor, alpha);
      }
    `,
  });
}
function getLocationClusterKey(checkIn: GlobeCheckIn): string {
  return `${Math.round(checkIn.latitude * 10) / 10}:${Math.round(checkIn.longitude * 10) / 10}`;
}

function getMarkerOffset(index: number, total: number): { x: number; y: number } {
  const midpoint = (total - 1) / 2;
  const distanceFromCenter = index - midpoint;

  return {
    x: Math.abs(distanceFromCenter) < 0.5 ? 0 : Math.sign(distanceFromCenter) * 16,
    y: distanceFromCenter * 24,
  };
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

function createSpotLightSprite(count: number, themeColors: GlobeThemeColors): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 60);
  gradient.addColorStop(0, themeColors.spotCore);
  gradient.addColorStop(0.2, themeColors.spotMid);
  gradient.addColorStop(0.48, themeColors.spotOuter);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
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

function getTriangleMaxEdgeDegrees(
  first: THREE.Vector2,
  second: THREE.Vector2,
  third: THREE.Vector2,
): number {
  return Math.max(
    first.distanceTo(second),
    second.distanceTo(third),
    third.distanceTo(first),
  );
}

function appendProjectedFillVertex(
  point: THREE.Vector2,
  vertices: number[],
): number {
  const vertex = latLonToVector(point.y, point.x, GLOBE_FILL_RADIUS);
  vertices.push(vertex.x, vertex.y, vertex.z);
  return vertices.length / 3 - 1;
}

function appendSubdividedFillTriangle(
  first: THREE.Vector2,
  second: THREE.Vector2,
  third: THREE.Vector2,
  vertices: number[],
  indices: number[],
  depth = 0,
): void {
  if (
    depth < MAX_FILL_SUBDIVISION_DEPTH &&
    getTriangleMaxEdgeDegrees(first, second, third) > MAX_FILL_TRIANGLE_EDGE_DEGREES
  ) {
    const firstSecondMidpoint = first.clone().add(second).multiplyScalar(0.5);
    const secondThirdMidpoint = second.clone().add(third).multiplyScalar(0.5);
    const thirdFirstMidpoint = third.clone().add(first).multiplyScalar(0.5);

    appendSubdividedFillTriangle(
      first,
      firstSecondMidpoint,
      thirdFirstMidpoint,
      vertices,
      indices,
      depth + 1,
    );
    appendSubdividedFillTriangle(
      firstSecondMidpoint,
      second,
      secondThirdMidpoint,
      vertices,
      indices,
      depth + 1,
    );
    appendSubdividedFillTriangle(
      thirdFirstMidpoint,
      secondThirdMidpoint,
      third,
      vertices,
      indices,
      depth + 1,
    );
    appendSubdividedFillTriangle(
      firstSecondMidpoint,
      secondThirdMidpoint,
      thirdFirstMidpoint,
      vertices,
      indices,
      depth + 1,
    );
    return;
  }

  const firstIndex = appendProjectedFillVertex(first, vertices);
  const secondIndex = appendProjectedFillVertex(second, vertices);
  const thirdIndex = appendProjectedFillVertex(third, vertices);
  indices.push(firstIndex, secondIndex, thirdIndex);
}

function createLandmassFillMeshFromPolygon(
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
  const flatPoints = [contour, ...holes].flat();

  if (!triangles.length || flatPoints.length < 3) {
    return null;
  }

  const vertices: number[] = [];
  const indices: number[] = [];

  for (const [firstIndex, secondIndex, thirdIndex] of triangles) {
    appendSubdividedFillTriangle(
      flatPoints[firstIndex],
      flatPoints[secondIndex],
      flatPoints[thirdIndex],
      vertices,
      indices,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(vertices), 3),
  );
  geometry.setIndex(indices);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 0;
  return mesh;
}

function addLandmassFills(
  fillGroup: THREE.Group,
  themeColors: GlobeThemeColors,
): void {
  const material = createLandmassFillMaterial(themeColors.fill);

  for (const feature of LANDMASSES.features ?? []) {
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
      const fillMesh = createLandmassFillMeshFromPolygon(polygon, material);

      if (fillMesh) {
        fillGroup.add(fillMesh);
      }
    }
  }
}

function addLandmassBorders(
  borderGroup: THREE.Group,
  themeColors: GlobeThemeColors,
): void {
  const material = createCountryBorderMaterial(themeColors.border);

  for (const feature of LANDMASSES.features ?? []) {
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
  themeColors: GlobeThemeColors,
): void {
  if (!highlightedCountryKeys.size) {
    return;
  }

  const outerMaterial = createActiveCountryBorderMaterial(themeColors.activeOuter, 0.68);
  const innerMaterial = createActiveCountryBorderMaterial(themeColors.activeInner, 1);

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
  cameraDistance = DEFAULT_CAMERA_Z,
  className = '',
  focusCheckIn = null,
  globeTiltX = GLOBE_TILT_X,
  globeTiltZ = 0,
  onFocusMarkerPlace,
  onFocusComplete,
}: {
  checkIns: GlobeCheckIn[];
  config: GlobeConfig;
  cameraDistance?: number;
  className?: string;
  focusCheckIn?: { checkIn: GlobeCheckIn; requestId: number } | null;
  globeTiltX?: number;
  globeTiltZ?: number;
  onFocusMarkerPlace?: (checkIn: GlobeCheckIn) => void;
  onFocusComplete?: (checkIn: GlobeCheckIn) => void;
}) {
  const showDebugInfo =
    import.meta.env.DEV || LOCAL_HOSTNAMES.has(window.location.hostname);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const debugInfoRef = useRef<HTMLPreElement | null>(null);
  const markerVisualsRef = useRef<GlobeMarkerVisual[]>([]);
  const markerGroupRef = useRef<THREE.Group | null>(null);
  const fillGroupRef = useRef<THREE.Group | null>(null);
  const borderGroupRef = useRef<THREE.Group | null>(null);
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
  const globeTiltXRef = useRef(globeTiltX);
  const globeTiltZRef = useRef(globeTiltZ);
  const rotationSpeedRef = useRef(config.rotationSpeed);
  const showLabelsRef = useRef(config.showLabels);
  const onFocusMarkerPlaceRef = useRef(onFocusMarkerPlace);
  const onFocusCompleteRef = useRef(onFocusComplete);

  useEffect(() => {
    rotationSpeedRef.current = config.rotationSpeed;
    showLabelsRef.current = config.showLabels;
  }, [config.rotationSpeed, config.showLabels]);

  useEffect(() => {
    globeTiltXRef.current = globeTiltX;
    globeTiltZRef.current = globeTiltZ;
  }, [globeTiltX, globeTiltZ]);

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
    camera.position.set(0, 0, cameraDistance);
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
    globeGroup.quaternion.copy(
      createGlobeOrientation(
        INITIAL_GLOBE_YAW,
        globeTiltXRef.current,
        globeTiltZRef.current,
      ),
    );
    scene.add(globeGroup);
    globeGroupRef.current = globeGroup;

    const globeDepthGeometry = new THREE.SphereGeometry(GLOBE_OCCLUSION_RADIUS, 64, 64);
    const globeDepthMaterial = new THREE.MeshBasicMaterial();
    globeDepthMaterial.colorWrite = false;
    const globeDepthMesh = new THREE.Mesh(globeDepthGeometry, globeDepthMaterial);
    globeDepthMesh.renderOrder = -1;
    globeGroup.add(globeDepthMesh);

    const fillGroup = new THREE.Group();
    globeGroup.add(fillGroup);
    fillGroupRef.current = fillGroup;

    const borderGroup = new THREE.Group();
    globeGroup.add(borderGroup);
    borderGroupRef.current = borderGroup;

    const activeCountryBorderGroup = new THREE.Group();
    globeGroup.add(activeCountryBorderGroup);
    activeCountryBorderGroupRef.current = activeCountryBorderGroup;

    const markerGroup = new THREE.Group();
    globeGroup.add(markerGroup);
    markerGroupRef.current = markerGroup;

    addLandmassBorders(borderGroup, getGlobeThemeColors(config.globeColor));


    function resize() {
      const width = sceneContainer.clientWidth || window.innerWidth;
      const height = sceneContainer.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    }

    const rendererSize = new THREE.Vector2();
    const globeCenter = new THREE.Vector3();
    const cameraPosition = new THREE.Vector3();
    const worldSurfacePosition = new THREE.Vector3();
    const surfaceNormal = new THREE.Vector3();
    const cameraDirection = new THREE.Vector3();
    const projectedGlobeCenter = new THREE.Vector3();
    const projectedGlobeEdge = new THREE.Vector3();
    const projectedLabelPosition = new THREE.Vector3();
    const globePosition = new THREE.Vector3();
    const globeRotation = new THREE.Euler();
    const cameraRotation = new THREE.Euler();
    let lastDebugUpdate = 0;

    let previousFrameTime = performance.now();

    function renderFrame(frameTime: number) {
      const deltaSeconds = Math.min(
        Math.max((frameTime - previousFrameTime) / 1_000, 0),
        0.1,
      );
      previousFrameTime = frameTime;
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
          camera.position.z = cameraDistance;
        } else if (elapsed <= FOCUS_ROTATION_MS + FOCUS_HOLD_MS) {
          globeGroup.quaternion.copy(focusAnimation.targetQuaternion);
          camera.position.z = cameraDistance;

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
          camera.position.z = cameraDistance;
        } else {
          if (!focusAnimation.markerPlaced) {
            focusAnimation.markerPlaced = true;
            onFocusMarkerPlaceRef.current?.(focusAnimation.checkIn);
          }

          camera.position.z = cameraDistance;
          globeGroup.quaternion.copy(focusAnimation.resumeQuaternion);
          focusAnimationRef.current = null;
          onFocusCompleteRef.current?.(focusAnimation.checkIn);
        }
      } else {
        const rotationsPerSecond = getGlobeRotationsPerSecond(
          rotationSpeedRef.current,
        );
        globeGroup.quaternion.copy(
          createGlobeOrientation(
            getYawFromGlobeOrientation(globeGroup.quaternion) +
              rotationsPerSecond * Math.PI * 2 * deltaSeconds,
            globeTiltXRef.current,
            globeTiltZRef.current,
          ),
        );
      }

      globeGroup.updateMatrixWorld();

      renderer.getSize(rendererSize);
      globeCenter.setFromMatrixPosition(globeGroup.matrixWorld);
      camera.getWorldPosition(cameraPosition);

      projectedGlobeCenter.copy(globeCenter).project(camera);
      projectedGlobeEdge
        .set(globeCenter.x + GLOBE_RADIUS, globeCenter.y, globeCenter.z)
        .project(camera);
      const globeRadiusPx =
        Math.abs(projectedGlobeEdge.x - projectedGlobeCenter.x) * 0.5 * rendererSize.x;
      const globeDiameterPx = Math.max(globeRadiusPx * 2, 220);
      sceneContainer.style.setProperty(
        '--globe-screen-diameter',
        `${globeDiameterPx}px`,
      );

      if (
        showDebugInfo &&
        debugInfoRef.current &&
        performance.now() - lastDebugUpdate >= 100
      ) {
        globeGroup.getWorldPosition(globePosition);
        globeRotation.setFromQuaternion(globeGroup.quaternion, 'YXZ');
        cameraRotation.setFromQuaternion(camera.quaternion, 'YXZ');
        debugInfoRef.current.textContent = [
          `Globe position  ${formatVector(globePosition)}`,
          `Globe rotation  ${formatRotation(globeRotation)}`,
          `Camera position ${formatVector(cameraPosition)}`,
          `Camera rotation ${formatRotation(cameraRotation)}`,
        ].join('\n');
        lastDebugUpdate = performance.now();
      }

      for (const markerVisual of markerVisualsRef.current) {
        worldSurfacePosition
          .copy(markerVisual.surfacePosition)
          .applyMatrix4(globeGroup.matrixWorld);
        surfaceNormal.copy(worldSurfacePosition).sub(globeCenter).normalize();
        cameraDirection.copy(cameraPosition).sub(worldSurfacePosition).normalize();
        const isFrontFacing = surfaceNormal.dot(cameraDirection) > 0;

        markerVisual.objects.forEach((object) => {
          object.visible = isFrontFacing;
        });

        if (!markerVisual.element || !markerVisual.labelPosition) {
          continue;
        }

        projectedLabelPosition
          .copy(markerVisual.labelPosition)
          .applyMatrix4(globeGroup.matrixWorld);
        projectedLabelPosition.project(camera);
        const labelVisible = showLabelsRef.current && isFrontFacing;
        markerVisual.element.style.opacity = labelVisible ? '1' : '0';
        markerVisual.element.style.visibility = labelVisible ? 'visible' : 'hidden';

        if (!labelVisible) {
          continue;
        }

        const x = (projectedLabelPosition.x * 0.5 + 0.5) * rendererSize.x;
        const y = (-projectedLabelPosition.y * 0.5 + 0.5) * rendererSize.y;

        markerVisual.element.style.left = `${x}px`;
        markerVisual.element.style.top = `${y}px`;
        markerVisual.element.style.setProperty(
          '--marker-label-offset-x',
          `${markerVisual.labelOffsetX ?? 0}px`,
        );
        markerVisual.element.style.setProperty(
          '--marker-label-offset-y',
          `${markerVisual.labelOffsetY ?? 0}px`,
        );
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
      markerVisualsRef.current.forEach((visual) => visual.element?.remove());
      markerVisualsRef.current = [];
      renderer.dispose();
      disposeGroup(fillGroup);
      disposeGroup(borderGroup);
      disposeGroup(activeCountryBorderGroup);
      globeDepthGeometry.dispose();
      globeDepthMaterial.dispose();
      fillGroupRef.current = null;
      borderGroupRef.current = null;
      activeCountryBorderGroupRef.current = null;
      sceneContainer.removeChild(renderer.domElement);
    };
  }, [cameraDistance, showDebugInfo]);

  useEffect(() => {
    const fillGroup = fillGroupRef.current;
    const borderGroup = borderGroupRef.current;
    const activeCountryBorderGroup = activeCountryBorderGroupRef.current;

    if (!fillGroup || !borderGroup || !activeCountryBorderGroup) {
      return;
    }

    const themeColors = getGlobeThemeColors(config.globeColor);

    disposeGroup(borderGroup);
    borderGroup.clear();
    addLandmassBorders(borderGroup, themeColors);
    disposeGroup(fillGroup);
    fillGroup.clear();
    disposeGroup(activeCountryBorderGroup);
    activeCountryBorderGroup.clear();
  }, [checkIns, config.globeColor]);

  useEffect(() => {
    const globeGroup = globeGroupRef.current;
    const camera = cameraRef.current;

    if (!focusCheckIn) {
      focusAnimationRef.current = null;
      return;
    }

    if (!globeGroup || !camera) {
      return;
    }

    const focusKey = String(focusCheckIn.requestId);

    if (placedFocusKeyRef.current === focusKey) {
      return;
    }

    placedFocusKeyRef.current = focusKey;
    const totalFocusDuration = FOCUS_ROTATION_MS + FOCUS_HOLD_MS + FOCUS_RESUME_MS;
    const startYaw = getYawFromGlobeOrientation(globeGroup.quaternion);
    const rotationsPerSecond = getGlobeRotationsPerSecond(
      rotationSpeedRef.current,
    );
    const defaultRotationDuringFocus =
      rotationsPerSecond * Math.PI * 2 * (totalFocusDuration / 1_000);
    const resumeQuaternion = createGlobeOrientation(
      startYaw + defaultRotationDuringFocus,
      globeTiltXRef.current,
      globeTiltZRef.current,
    );
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
    markerVisualsRef.current.forEach((visual) => visual.element?.remove());
    markerVisualsRef.current = [];

    const themeColors = getGlobeThemeColors(config.globeColor);
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: themeColors.marker,
      emissive: themeColors.marker,
      emissiveIntensity: 0.45,
      roughness: 0.35,
    });
    const markerHeadGeometry = new THREE.SphereGeometry(0.008, 16, 16);
    const markerStemGeometry = new THREE.CylinderGeometry(0.0015, 0.003, 0.1, 10);

    for (const lightSpot of buildLightSpots(checkIns)) {
      const spotLight = createSpotLightSprite(lightSpot.count, themeColors);
      const surfacePosition = latLonToVector(
        lightSpot.latitude,
        lightSpot.longitude,
        GLOBE_RADIUS * 1.02,
      );
      spotLight.position.copy(surfacePosition);
      markerGroup.add(spotLight);
      markerVisualsRef.current.push({
        objects: [spotLight],
        surfacePosition,
      });
    }

    const checkInsByLocation = new Map<string, GlobeCheckIn[]>();

    for (const checkIn of checkIns) {
      const locationKey = getLocationClusterKey(checkIn);
      const locationCheckIns = checkInsByLocation.get(locationKey);

      if (locationCheckIns) {
        locationCheckIns.push(checkIn);
      } else {
        checkInsByLocation.set(locationKey, [checkIn]);
      }
    }

    const labelOffsetsByViewer = new Map<string, { x: number; y: number }>();

    for (const locationCheckIns of checkInsByLocation.values()) {
      locationCheckIns
        .slice()
        .sort(
          (left, right) =>
            left.viewerName.localeCompare(right.viewerName) || left.updatedAt - right.updatedAt,
        )
        .forEach((checkIn, index, cluster) => {
          labelOffsetsByViewer.set(checkIn.id, getMarkerOffset(index, cluster.length));
        });
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
      const labelOffset = labelOffsetsByViewer.get(checkIn.id) ?? { x: 0, y: 0 };
      markerVisualsRef.current.push({
        element: label,
        labelOffsetX: labelOffset.x,
        labelOffsetY: labelOffset.y,
        labelPosition,
        objects: [marker, stem],
        surfacePosition,
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
  }, [checkIns, config.globeColor]);

  return (
    <div ref={containerRef} className={`globe-canvas ${className}`.trim()}>
      {showDebugInfo ? (
        <pre ref={debugInfoRef} className="globe-debug-info" aria-live="off" />
      ) : null}
    </div>
  );
}

function upsertCheckIn(checkIns: GlobeCheckIn[], nextCheckIn: GlobeCheckIn): GlobeCheckIn[] {
  const withoutExisting = checkIns.filter(
    (checkIn) => checkIn.viewerName.toLowerCase() !== nextCheckIn.viewerName.toLowerCase(),
  );

  return [nextCheckIn, ...withoutExisting].sort((a, b) => b.updatedAt - a.updatedAt);
}

function getCheckInFocusKey(checkIn: GlobeCheckIn): string {
  return `${checkIn.viewerName.toLowerCase()}|${checkIn.updatedAt}`;
}

export function GlobeOverlayPage() {
  const config = useMemo(() => parseGlobeConfig(window.location.search), []);
  const isLocalRuntime =
    import.meta.env.DEV || LOCAL_HOSTNAMES.has(window.location.hostname);
  const [checkIns, setCheckIns] = useState<GlobeCheckIn[]>([]);
  const [focusCheckIn, setFocusCheckIn] = useState<{
    checkIn: GlobeCheckIn;
    requestId: number;
  } | null>(null);
  const [status, setStatus] = useState('Starting globe');
  const checkInsRef = useRef<GlobeCheckIn[]>([]);
  const focusCheckInRef = useRef<typeof focusCheckIn>(null);
  const focusQueueRef = useRef<GlobeCheckIn[]>([]);
  const queuedFocusKeysRef = useRef(new Set<string>());
  const pendingLocationsRef = useRef(new Set<string>());
  const focusRequestIdRef = useRef(0);

  useEffect(() => {
    checkInsRef.current = checkIns;
  }, [checkIns]);

  useEffect(() => {
    focusCheckInRef.current = focusCheckIn;
  }, [focusCheckIn]);

  function startFocusCheckIn(checkIn: GlobeCheckIn) {
    focusRequestIdRef.current += 1;
    setFocusCheckIn({
      checkIn,
      requestId: focusRequestIdRef.current,
    });
  }

  function focusExistingCheckIn(checkIn: GlobeCheckIn) {
    if (!config.animateCheckIns) {
      setCheckIns((current) => upsertCheckIn(current, checkIn));
      return;
    }

    const focusKey = getCheckInFocusKey(checkIn);
    const currentFocus = focusCheckInRef.current;

    if (currentFocus && getCheckInFocusKey(currentFocus.checkIn) === focusKey) {
      return;
    }

    if (queuedFocusKeysRef.current.has(focusKey)) {
      return;
    }

    if (currentFocus) {
      queuedFocusKeysRef.current.add(focusKey);
      focusQueueRef.current.push(checkIn);
      return;
    }

    startFocusCheckIn(checkIn);
  }

  function clearFocusQueue() {
    focusQueueRef.current = [];
    queuedFocusKeysRef.current.clear();
  }

  function advanceFocusQueue(completedCheckIn: GlobeCheckIn) {
    const completedFocusKey = getCheckInFocusKey(completedCheckIn);
    queuedFocusKeysRef.current.delete(completedFocusKey);

    while (focusQueueRef.current.length > 0) {
      const nextCheckIn = focusQueueRef.current.shift();

      if (!nextCheckIn) {
        continue;
      }

      const nextFocusKey = getCheckInFocusKey(nextCheckIn);
      queuedFocusKeysRef.current.delete(nextFocusKey);

      if (completedFocusKey === nextFocusKey) {
        continue;
      }

      startFocusCheckIn(nextCheckIn);
      return;
    }

    setFocusCheckIn((current) =>
      current?.checkIn.id === completedCheckIn.id &&
      current.checkIn.updatedAt === completedCheckIn.updatedAt
        ? null
        : current,
    );
  }

  useEffect(() => {
    if (!config.animateCheckIns) {
      clearFocusQueue();
      setFocusCheckIn(null);
    }
  }, [config.animateCheckIns]);

  function resetGlobeSession() {
    clearFocusQueue();
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
    let hasLoaded = false;
    let requestInFlight = false;

    async function refreshCheckIns() {
      if (requestInFlight || focusCheckInRef.current) {
        return;
      }

      requestInFlight = true;

      try {
        const loadedCheckIns = (
          await fetchGlobeCheckIns(config.sessionId, controller.signal)
        ).sort((a, b) => b.updatedAt - a.updatedAt);

        if (!hasLoaded) {
          hasLoaded = true;
          setCheckIns(loadedCheckIns);
          return;
        }

        const currentByViewer = new Map(
          checkInsRef.current.map((checkIn) => [
            checkIn.viewerName.toLowerCase(),
            checkIn,
          ]),
        );
        const changedCheckIns = loadedCheckIns.filter((checkIn) => {
          const current = currentByViewer.get(checkIn.viewerName.toLowerCase());
          return !current || current.updatedAt < checkIn.updatedAt;
        });

        if (changedCheckIns.length > 0 && config.animateCheckIns) {
          const changedViewerKeys = new Set(
            changedCheckIns.map((checkIn) => checkIn.viewerName.toLowerCase()),
          );
          setCheckIns(
            loadedCheckIns.filter(
              (checkIn) => !changedViewerKeys.has(checkIn.viewerName.toLowerCase()),
            ),
          );

          changedCheckIns
            .slice()
            .sort((left, right) => left.updatedAt - right.updatedAt)
            .forEach((checkIn) => {
              focusExistingCheckIn(checkIn);
            });
          return;
        }

        setCheckIns(loadedCheckIns);
      } catch {
        if (!controller.signal.aborted) {
          setStatus('Unable to load saved check-ins.');
        }
      } finally {
        requestInFlight = false;
      }
    }

    void refreshCheckIns();
    const intervalId = isLocalRuntime
      ? window.setInterval(() => void refreshCheckIns(), LOCAL_CHECK_IN_REFRESH_MS)
      : null;

    return () => {
      controller.abort();

      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [config.animateCheckIns, config.sessionId, isLocalRuntime]);

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
  }, [config.animateCheckIns, config.channel, config.sessionId]);

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
          advanceFocusQueue(checkIn);
        }}
      />
      <span className="sr-only">{status}</span>
    </main>
  );
}
