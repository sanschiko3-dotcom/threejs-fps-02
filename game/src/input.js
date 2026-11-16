// Keyboard + pointer-lock input. Owns nothing about the game: it reports which keys
// are down, mouse-look deltas since the last read, and whether the trigger is held.
// Pointer lock is requested by the HUD's play button; the game never locks on its own.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  let lookX = 0;
  let lookY = 0;
  let firing = false;
  let aiming = false;
  let locked = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    keys.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (!locked) return;
    lookX += event.movementX;
    lookY += event.movementY;
  }
  function onMouseDown(event) {
    if (!locked) return;
    if (event.button === 0) firing = true;
    if (event.button === 2) aiming = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) firing = false;
    if (event.button === 2) aiming = false;
  }
  function onLock() {
    locked = document.pointerLockElement === canvas;
    if (!locked) { firing = false; aiming = false; }
    if (onLockChange) onLockChange(locked);
  }

  canvas.addEventListener('contextmenu', event => event.preventDefault());
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);

  return {
    state: { keys, get aiming() { return aiming; }, get firing() { return firing; } },
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    requestLock() {
      canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    isLocked() {
      return locked;
    },
    // Used by the deterministic screenshot path: feed synthetic input without a pointer.
    feedLook(dx, dy) {
      lookX += dx;
      lookY += dy;
    },
    setFiring(value) {
      firing = value;
    },
  };
}
