/** Fullscreen keeps the existing editor, state and job controller intact. */
export function editorFocusButton(root: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '全屏线路';
  button.title = '全屏显示线路工作台，按 Esc 返回';
  button.addEventListener('click', () => {
    if (document.fullscreenElement === root) {
      void document.exitFullscreen();
    } else {
      void root.requestFullscreen().catch(() => {
        button.textContent = '浏览器未允许全屏';
      });
    }
  });
  return button;
}
