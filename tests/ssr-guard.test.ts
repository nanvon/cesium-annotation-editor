import { describe, expect, it } from 'vitest';
import { CesiumAnnotationEditor } from '../src/CesiumAnnotationEditor';
import { createFakeViewer, removeBrowserGlobals } from './testUtils';

describe('SSR/browser guard', () => {
  it('constructs and destroys without window or document when toolbar is disabled', () => {
    const restore = removeBrowserGlobals();
    try {
      const editor = new CesiumAnnotationEditor(createFakeViewer(), { toolbar: false });
      expect(editor.isDestroyed()).toBe(false);
      editor.destroy();
      expect(editor.isDestroyed()).toBe(true);
    } finally {
      restore();
    }
  });
});
