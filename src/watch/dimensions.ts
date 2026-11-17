// Shared millimetre dimensions of the study model. Every part module builds
// against these, so parts made independently still fit together.
//
// Axes: the dial faces +Y, twelve o'clock points to -Z, the crown sits at +X.
//
// The calendar displays follow the dial drawing the movement maker publishes
// for the reference calibre ("Indications for dial"): the moon disc turns on
// an axis 7.00 mm below the dial centre and shows inside a radius of 5.10 about
// that axis, and the date window measures 2.70 × 2.00 mm with its inner edge
// 8.85 mm from the centre. The reference watch opens that whole circle as a
// round window and closes its lower part with a cloud plate.

/** Height of the dial surface above the case centre plane. */
export const DIAL_Y = 2.25;
/** Radius of the visible dial. */
export const DIAL_R = 16.2;

/** Axis of the moon disc and centre of the round moon window: distance from the dial centre, towards six. */
export const APERTURE_CENTER = 7;
/** Radius of the moon window, the bore through the dial; its bevel lies outside this radius. */
export const APERTURE_R = 5.1;
/** Upper outline of the cloud plate in the window: two clouds of this radius,
 * this far either side of the axis, their centres this far below it (towards
 * six). They are wider than the calibre drawing's 2.06 mm arcs, so they run
 * out into the rim of the window as on the reference watch. */
export const CLOUD_R = 2.3;
export const CLOUD_OFFSET = 3.02;
export const CLOUD_DROP = 0.25;
/** The small rise between the two clouds; its centre lies on the line of the cloud centres. */
export const CLOUD_GAP_R = 1.05;
/** The moons: a moon at the top of its orbit stands free of clouds, rise and
 * rim by 0.2 mm or more; a quarter turn on, it lies wholly behind a cloud. */
export const MOON_ORBIT_R = 2.95;
export const MOON_R = 1.9;

/** Date window centre, towards three (inner edge at 8.85 mm). */
export const DATE_CENTER_X = 10.2;
export const DATE_W = 2.7;
export const DATE_H = 2;

/** Widest radius of the middle case (39 mm nominal diameter). */
export const CASE_R = 19.5;
/** Top of the bezel, where the crystal starts. */
export const BEZEL_TOP_Y = 4.4;
/** Underside of the caseback. */
export const CASE_BOTTOM_Y = -4.6;
/** Inner face of the caseback, flush with the lip of the case it screws against. The movement's
 * oscillating weight clears it by 0.43 mm (the movement maker asks for 0.35 to 0.55). */
export const CASEBACK_INNER_Y = -3.98;
/** Inner radius of the bezel opening / crystal seat. */
export const CRYSTAL_R = 17;
/** Half the lug gap: the reference watch takes a 21 mm bracelet. */
export const LUG_INNER_X = 10.5;
/** Lug tips end at this distance from the centre along ±Z. */
export const LUG_TIP_Z = 23;
/** Spring bar between the lug tips: the bore in the lugs and the first pivot of the bracelet. */
export const SPRING_BAR_Z = 21.6;
export const SPRING_BAR_Y = -2.6;

/** Crown axis: resting x of the crown carriage, travel per position, height. */
export const CROWN_BASE_X = 20.85;
export const CROWN_TRAVEL = 1.1;
export const CROWN_Y = -1;

/**
 * Daily steps of the moon disc per revolution. In the reference calibre the
 * disc is a wheel of 118 teeth that a 14-point star wheel with a 28-leaf pinion
 * moves on by two teeth per day or per quick-set click: 14 × 118 / 28 = 59.
 */
export const MOON_DISC_STEPS = 59;
/** Steps between two full-moon poses: the disc carries two moons half a turn apart. */
export const MOON_DISC_PERIOD = MOON_DISC_STEPS / 2;
/** The date ring has 31 positions regardless of the month. */
export const DATE_POSITIONS = 31;

// Calendar layers under the dial plate, from top to bottom.
/** Moon disc: concentric with its aperture, just under the dial. */
export const MOON_DISC_Y = DIAL_Y - 0.45;
export const MOON_DISC_R = 5.4;
export const MOON_DISC_CENTER_Z = APERTURE_CENTER;
/** Date ring: 31 numerals on an annulus centred on the dial axis, below the moon disc. */
export const DATE_RING_Y = DIAL_Y - 0.62;
export const DATE_RING_INNER_R = 8.7;
export const DATE_RING_OUTER_R = 11.7;

/** Lowest point of the closed bracelet loop (outside of the clasp); the studio
 * floor and its contact shadow sit here. */
export const GROUND_Y = -56;
