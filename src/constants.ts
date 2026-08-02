export const SWIPE_THRESHOLD = 0.2;
// How far a touch has to travel before the pager reads a direction from it.
// This sits above the platform touch slop (8dp on Android) on purpose: a
// scrollable nested inside a page starts its own native gesture at that slop,
// which ends the pager's negotiation, so the nested scrollable keeps the touch
// instead of the pager taking it away.
export const DIRECTION_THRESHOLD = 20;
export const VELOCITY_THRESHOLD = 0.5;
export const CONTINUOUS_PRELOAD_THRESHOLD = 0;
export const INITIAL_PRELOAD_THRESHOLD = 0.1;
