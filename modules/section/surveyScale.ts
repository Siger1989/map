/** Engineering ratios refer to printing the complete 1800-unit sheet at 420 mm wide. */
export const SURVEY_SCALES = [
  500, 1000, 2000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000,
];
export const SURVEY_PX_PER_MM = 1800 / 420;
export const SURVEY_PLOT_WIDTH = 1180;
export function surveyScaleWidth(span: number, scale?: number) {
  const width = scale
    ? (span * 1000 * SURVEY_PX_PER_MM) / scale
    : SURVEY_PLOT_WIDTH;
  if (width > SURVEY_PLOT_WIDTH + 0.01)
    throw new Error('所选比例尺无法容纳全线，请改用更大的分母或自动铺满');
  return width;
}
export function surveyHorizontalScale(span: number, width: number) {
  return (span * 1000 * SURVEY_PX_PER_MM) / width;
}
