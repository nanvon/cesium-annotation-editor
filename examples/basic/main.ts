import {
  Cartesian3,
  ImageryLayer,
  Math as CesiumMath,
  SceneMode,
  UrlTemplateImageryProvider,
  Viewer,
  WebMercatorTilingScheme
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { CesiumAnnotationEditor, type AnnotationJSON } from '../../src';
import '../../src/styles.css';
import './style.css';

const amapProvider = new UrlTemplateImageryProvider({
  url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
  subdomains: ['1', '2', '3', '4'],
  minimumLevel: 3,
  maximumLevel: 18,
  tilingScheme: new WebMercatorTilingScheme(),
  credit: '高德卫星图'
});

const viewer = new Viewer('cesiumContainer', {
  animation: false,
  timeline: false,
  geocoder: false,
  sceneMode: SceneMode.SCENE3D,
  sceneModePicker: false,
  baseLayer: new ImageryLayer(amapProvider),
  baseLayerPicker: false,
  navigationHelpButton: false,
  homeButton: false,
  infoBox: false,
  selectionIndicator: false,
  skyBox: false,
  skyAtmosphere: false
});

viewer.camera.setView({
  destination: Cartesian3.fromDegrees(117.2272, 31.8206, 26000),
  orientation: {
    heading: CesiumMath.toRadians(0),
    pitch: CesiumMath.toRadians(-90),
    roll: 0
  }
});

const editor = new CesiumAnnotationEditor(viewer, {
  toolbar: {
    position: 'top-left'
  },
  circle: {
    minRadius: 50,
    maxRadius: 5000000
  },
  snapping: {
    enabled: true,
    snapDistance: 20
  }
});

const mode = document.querySelector<HTMLParagraphElement>('#mode');
const count = document.querySelector<HTMLParagraphElement>('#count');
const output = document.querySelector<HTMLTextAreaElement>('#output');
const exportButton = document.querySelector<HTMLButtonElement>('#export');
const importButton = document.querySelector<HTMLButtonElement>('#import');
const clearButton = document.querySelector<HTMLButtonElement>('#clear');
const status = document.querySelector<HTMLParagraphElement>('#status');

function refresh(): void {
  if (mode) {
    mode.textContent = `mode: ${editor.getMode()}`;
  }
  if (count) {
    count.textContent = `annotations: ${editor.getAnnotations().length}`;
  }
}

editor.on('modechange', refresh);
editor.on('change', refresh);
editor.on('select', refresh);
refresh();

exportButton?.addEventListener('click', () => {
  setOutput(JSON.stringify(editor.toJSON(), null, 2));
  setStatus(`Exported ${editor.getAnnotations().length} annotations.`);
});

importButton?.addEventListener('click', () => {
  if (!output) {
    return;
  }

  try {
    const items = parseAnnotationJSON(output.value);
    editor.fromJSON(items, { clear: true });
    refresh();
    setOutput(JSON.stringify(editor.toJSON(), null, 2));
    setStatus(`Imported ${items.length} annotations.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Invalid JSON.', true);
  }
});

output?.addEventListener('input', () => {
  updateImportButton();
  setStatus('');
});

clearButton?.addEventListener('click', () => {
  editor.clearAnnotations();
  setOutput('');
  setStatus('');
});

Object.assign(window, { viewer, editor });

function setOutput(value: string): void {
  if (!output) {
    return;
  }
  output.value = value;
  updateImportButton();
}

function updateImportButton(): void {
  if (!output || !importButton) {
    return;
  }
  const hasInput = output.value.trim().length > 0;
  importButton.disabled = !hasInput;
  importButton.classList.toggle('is-visible', hasInput);
}

function parseAnnotationJSON(value: string): AnnotationJSON[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('JSON must be an annotation array.');
  }
  return parsed as AnnotationJSON[];
}

function setStatus(message: string, isError = false): void {
  if (!status) {
    return;
  }
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}
