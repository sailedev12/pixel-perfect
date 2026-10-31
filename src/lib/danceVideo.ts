// Which copy of the dancer video is showing right now, and how visible it is. The video player writes this every
// frame; the particle stage reads it to make particles stream off her body.
/** Moments in the song (seconds into the clip): the bass drops out and she blows away, then it slams back and she reforms. */
export const BREAK = 22.8;
export const DROP = 24.27;

export const danceVideo = {
  el: null as HTMLVideoElement | null,
  alpha: 0,
  /**
   * 0 while she's fully formed and dancing, up to 1 while she blows away or rises back out of a column of sand (the
   * stage then treats her feet like the rest of her, so they dissolve and reform with her body).
   */
  unformed: 0,
};
