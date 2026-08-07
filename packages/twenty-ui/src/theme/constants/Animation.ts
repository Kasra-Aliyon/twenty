export const ANIMATION = {
  duration: {
    instant: 0.075,
    fast: 0.12,
    normal: 0.2,
    slow: 1.5,
  },
};

export type AnimationDuration = keyof typeof ANIMATION.duration;
