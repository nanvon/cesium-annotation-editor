import type { CesiumAnnotationEditorOptions, NormalizedOptions } from './types';

const defaultStyles = {
  pointColor: '#2f80ed',
  pointOutlineColor: '#ffffff',
  pointPixelSize: 10,
  lineColor: '#2f80ed',
  lineWidth: 3,
  fillColor: 'rgba(47, 128, 237, 0.26)',
  outlineColor: '#2f80ed',
  outlineWidth: 2,
  handleColor: '#ffffff',
  handleOutlineColor: '#2f80ed',
  snapColor: 'rgba(47, 128, 237, 0.18)',
  snapOutlineColor: '#2f80ed',
  snapPixelSize: 16,
  workingColor: '#2f80ed'
};

export function normalizeOptions(options: CesiumAnnotationEditorOptions = {}): NormalizedOptions {
  return {
    toolbar: options.toolbar ?? true,
    shapes: options.shapes ?? ['point', 'polyline', 'circle', 'polygon'],
    clampToGround: options.clampToGround ?? true,
    heightMode: options.heightMode ?? 'terrain',
    continueDrawing: {
      point: true,
      ...options.continueDrawing
    },
    circle: {
      resizeable: options.circle?.resizeable ?? true,
      minRadius: options.circle?.minRadius ?? 1,
      maxRadius: options.circle?.maxRadius
    },
    edit: {
      singleSelection: options.edit?.singleSelection ?? true,
      allowVertexInsert: options.edit?.allowVertexInsert ?? false,
      allowVertexDelete: options.edit?.allowVertexDelete ?? false
    },
    drag: {
      strategy: options.drag?.strategy ?? 'cartographic-delta'
    },
    snapping: {
      enabled: options.snapping?.enabled ?? true,
      snapDistance: options.snapping?.snapDistance ?? 20,
      snapVertex: options.snapping?.snapVertex ?? true,
      snapSegment: options.snapping?.snapSegment ?? true,
      showIndicator: options.snapping?.showIndicator ?? true,
      disableWithAlt: options.snapping?.disableWithAlt ?? true
    },
    styles: {
      ...defaultStyles,
      ...options.styles
    },
    destroyBehavior: options.destroyBehavior ?? 'keep-annotations'
  };
}
