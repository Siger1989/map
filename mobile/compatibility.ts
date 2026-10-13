import { installRelationalLayout } from './relationalLayout';
import { installKeyboardViewportCompatibility } from './keyboardViewport';
import { installAbortCompatibility } from '../modules/compatibility/abort';

installAbortCompatibility();

// Keep normal viewport units live; freeze only an editable field's IME resize.
installKeyboardViewportCompatibility(document, window, CSS.supports('height', '100dvh'));

export function installLayoutCompatibility() {
  installRelationalLayout();
}
