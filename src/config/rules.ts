/**
 * Movement and throwing rules. These are the knobs that differ between regional variants of Suwe;
 * the hop-path builder and validators read them instead of assuming one variant.
 */
export interface SuweRules {
  id: string
  name: string
  /** The square holding the stone may never be stepped on until the stone is picked up. */
  skipMarkerSquare: boolean
  /** Hop to the rest area, turn round, and hop back to the throw line. */
  roundTrip: boolean
  /** On the way back, stop in the row before the stone and pick it up. */
  pickUpOnReturn: boolean
  /** After picking the stone up, hop into its (now empty) square instead of jumping over it. */
  landInMarkerSquareAfterPickup: boolean
  /** Side-by-side squares are landed with both feet, one in each (unless one holds the stone). */
  pairsNeedBothFeet: boolean
  /** A stone or foot touching a chalk line is a fault. */
  linesAreFaults: boolean
}

export const TRADITIONAL_RULES: SuweRules = {
  id: "traditional",
  name: "Traditional",
  skipMarkerSquare: true,
  roundTrip: true,
  pickUpOnReturn: true,
  landInMarkerSquareAfterPickup: true,
  pairsNeedBothFeet: true,
  linesAreFaults: true,
}

/** A gentler house rule set: a one-way run with no pick-up. */
export const ONE_WAY_RULES: SuweRules = {
  id: "one-way",
  name: "One Way",
  skipMarkerSquare: true,
  roundTrip: false,
  pickUpOnReturn: false,
  landInMarkerSquareAfterPickup: false,
  pairsNeedBothFeet: true,
  linesAreFaults: true,
}
