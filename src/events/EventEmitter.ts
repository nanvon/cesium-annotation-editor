import { annotationToGeomanLayer, annotationTypeToGeomanShape, editorModeToGeomanShape } from '../geoman';
import type {
  ButtonClickEvent,
  CancelEvent,
  ChangeEvent,
  CoreEditorEventMap,
  CoreEditorEventName,
  CreateEvent,
  DragEvent,
  DrawEvent,
  EditorErrorEvent,
  EditorEventHandler,
  EditorEventMap,
  EditorEventName,
  GeomanEventMap,
  GeomanEventName,
  ModeChangeEvent,
  UpdateEvent,
  VertexDragEvent
} from '../types';

const coreEventNames = new Set<CoreEditorEventName>([
  'buttonclick',
  'modechange',
  'drawstart',
  'drawend',
  'create',
  'add',
  'select',
  'update',
  'change',
  'vertexdragstart',
  'vertexdrag',
  'vertexdragend',
  'dragstart',
  'drag',
  'dragend',
  'cancel',
  'error'
]);

type GeomanAlias = {
  [K in GeomanEventName]: [K, GeomanEventMap[K]];
}[GeomanEventName];

export class EventEmitter {
  private handlers = new Map<EditorEventName, Set<EditorEventHandler<EditorEventName>>>();

  on<T extends EditorEventName>(name: T, handler: EditorEventHandler<T>): () => void {
    const handlers = this.handlers.get(name) ?? new Set();
    handlers.add(handler as EditorEventHandler<EditorEventName>);
    this.handlers.set(name, handlers);
    return () => this.off(name, handler);
  }

  off<T extends EditorEventName>(name: T, handler: EditorEventHandler<T>): void {
    this.handlers.get(name)?.delete(handler as EditorEventHandler<EditorEventName>);
  }

  once<T extends EditorEventName>(name: T, handler: EditorEventHandler<T>): () => void {
    const unsubscribe = this.on(name, (event) => {
      unsubscribe();
      handler(event);
    });
    return unsubscribe;
  }

  emit<T extends EditorEventName>(name: T, event: EditorEventMap[T]): void {
    this.emitDirect(name, event);
    if (!isCoreEventName(name)) {
      return;
    }

    for (const [aliasName, aliasEvent] of geomanAliases(name, event as CoreEditorEventMap[CoreEditorEventName])) {
      this.emitDirect(aliasName, aliasEvent);
    }
  }

  private emitDirect<T extends EditorEventName>(name: T, event: EditorEventMap[T]): void {
    const handlers = this.handlers.get(name);
    if (!handlers) {
      return;
    }

    for (const handler of Array.from(handlers)) {
      handler(event as EditorEventMap[EditorEventName]);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

function isCoreEventName(name: EditorEventName): name is CoreEditorEventName {
  return coreEventNames.has(name as CoreEditorEventName);
}

function geomanAliases(name: CoreEditorEventName, event: CoreEditorEventMap[CoreEditorEventName]): GeomanAlias[] {
  switch (name) {
    case 'buttonclick':
      return buttonClickAliases(event as ButtonClickEvent);
    case 'modechange':
      return modeChangeAliases(event as ModeChangeEvent);
    case 'drawstart':
      return [['pm:drawstart', geomanDrawEvent(event as DrawEvent)]];
    case 'drawend':
      return [['pm:drawend', geomanDrawEvent(event as DrawEvent)]];
    case 'create':
      return createAliases(event as CreateEvent);
    case 'update':
      return updateAliases(event as UpdateEvent);
    case 'change':
      return changeAliases(event as ChangeEvent);
    case 'vertexdragstart':
      return [['pm:markerdragstart', markerDragEvent(event as VertexDragEvent)]];
    case 'vertexdrag':
      return [['pm:markerdrag', markerDragEvent(event as VertexDragEvent)]];
    case 'vertexdragend':
      return markerDragEndAliases(event as VertexDragEvent);
    case 'dragstart':
      return [['pm:dragstart', geomanDragEvent(event as DragEvent)]];
    case 'drag':
      return [['pm:drag', geomanDragEvent(event as DragEvent)]];
    case 'dragend':
      return [['pm:dragend', geomanDragEvent(event as DragEvent)]];
    case 'cancel':
      return cancelAliases(event as CancelEvent);
    case 'error':
      return [['pm:error', geomanErrorEvent(event as EditorErrorEvent)]];
    default:
      return [];
  }
}

function createAliases(event: CreateEvent): GeomanAlias[] {
  return [['pm:create', { ...annotationToGeomanLayer(event.annotation), source: event.source }]];
}

function buttonClickAliases(event: ButtonClickEvent): GeomanAlias[] {
  const alias = {
    btnName: event.button,
    button: event.button,
    mode: event.mode
  };
  const aliases: GeomanAlias[] = [['pm:buttonclick', alias]];
  if (event.button === 'finish' || event.button === 'cancel' || event.button === 'removeLastVertex') {
    aliases.push(['pm:actionclick', alias]);
  }
  return aliases;
}

function modeChangeAliases(event: ModeChangeEvent): GeomanAlias[] {
  const aliases: GeomanAlias[] = [];
  const wasDraw = event.previousMode.startsWith('draw:');
  const isDraw = event.mode.startsWith('draw:');
  if (wasDraw || isDraw) {
    aliases.push([
      'pm:globaldrawmodetoggled',
      {
        enabled: isDraw,
        shape: editorModeToGeomanShape(event.mode) ?? editorModeToGeomanShape(event.previousMode) ?? undefined,
        mode: event.mode,
        previousMode: event.previousMode
      }
    ]);
  }
  if (event.previousMode === 'edit' || event.mode === 'edit') {
    aliases.push([
      'pm:globaleditmodetoggled',
      {
        enabled: event.mode === 'edit',
        mode: event.mode,
        previousMode: event.previousMode
      }
    ]);
  }
  if (event.previousMode === 'drag' || event.mode === 'drag') {
    aliases.push([
      'pm:globaldragmodetoggled',
      {
        enabled: event.mode === 'drag',
        mode: event.mode,
        previousMode: event.previousMode
      }
    ]);
  }
  return aliases;
}

function geomanDrawEvent(event: DrawEvent): GeomanEventMap['pm:drawstart'] {
  return {
    ...event,
    shape: event.type ? annotationTypeToGeomanShape(event.type) : undefined
  };
}

function updateAliases(event: UpdateEvent): GeomanAlias[] {
  const geomanEvent = {
    ...annotationToGeomanLayer(event.annotation),
    reason: event.reason
  };
  const aliases: GeomanAlias[] = [['pm:update', geomanEvent]];
  if (event.reason === 'vertex' || event.reason === 'center' || event.reason === 'radius') {
    aliases.push(['pm:edit', geomanEvent]);
  }
  return aliases;
}

function changeAliases(event: ChangeEvent): GeomanAlias[] {
  if (!event.annotation) {
    return [['pm:change', { source: event.source }]];
  }
  return [
    [
      'pm:change',
      {
        ...annotationToGeomanLayer(event.annotation),
        source: event.source
      }
    ]
  ];
}

function markerDragEvent(event: VertexDragEvent): GeomanEventMap['pm:markerdrag'] {
  return {
    ...annotationToGeomanLayer(event.annotation),
    vertexIndex: event.vertexIndex,
    indexPath: event.vertexIndex == null ? undefined : [event.vertexIndex],
    handleType: event.handleType,
    position: event.position
  };
}

function markerDragEndAliases(event: VertexDragEvent): GeomanAlias[] {
  const geomanEvent = markerDragEvent(event);
  const aliases: GeomanAlias[] = [['pm:markerdragend', geomanEvent]];
  if (event.handleType === 'center') {
    aliases.push(['pm:centerplaced', geomanEvent]);
  }
  return aliases;
}

function geomanDragEvent(event: DragEvent): GeomanEventMap['pm:drag'] {
  return {
    ...annotationToGeomanLayer(event.annotation),
    startPosition: event.startPosition,
    currentPosition: event.currentPosition
  };
}

function cancelAliases(event: CancelEvent): GeomanAlias[] {
  const geomanEvent = {
    ...event,
    shape: editorModeToGeomanShape(event.mode) ?? undefined
  };
  return [
    ['pm:cancel', geomanEvent],
    ['pm:globalcancel', geomanEvent]
  ];
}

function geomanErrorEvent(event: EditorErrorEvent): GeomanEventMap['pm:error'] {
  return {
    source: event.code,
    message: event.message,
    payload: event.cause,
    code: event.code,
    cause: event.cause
  };
}
