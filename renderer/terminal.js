// Drag-to-Resize Status Terminal
const terminalResizer = document.getElementById('terminal-resizer');
const statusTerminalEl = document.querySelector('.status-terminal');

if (terminalResizer && statusTerminalEl) {
  terminalResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.addEventListener('mousemove', handleTerminalResize);
    document.addEventListener('mouseup', stopTerminalResize);
    statusTerminalEl.classList.add('resizing');
  });

  function handleTerminalResize(e) {
    const rect = statusTerminalEl.getBoundingClientRect();
    // Calculate new height from cursor position to bottom of the element
    const newHeight = rect.bottom - e.clientY;
    
    // Enforce min/max height limits for usability
    if (newHeight >= 100 && newHeight <= 450) {
      statusTerminalEl.style.height = `${newHeight}px`;
    }
  }

  function stopTerminalResize() {
    document.removeEventListener('mousemove', handleTerminalResize);
    document.removeEventListener('mouseup', stopTerminalResize);
    statusTerminalEl.classList.remove('resizing');
  }
}
