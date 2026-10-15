/** Translate keyboard or existing touch stick into vehicle controls. */
export function vehicleInput(input) {
  const stick = input.stick ?? { x: 0, y: 0 };
  return {
    throttle: input.isDown('KeyW', 'ArrowUp')
      ? 1
      : input.isDown('KeyS', 'ArrowDown')
        ? -1
        : -stick.y,
    steer: input.isDown('KeyD', 'ArrowRight')
      ? 1
      : input.isDown('KeyA', 'ArrowLeft')
        ? -1
        : stick.x,
    brake: input.isDown('Space'),
  };
}
