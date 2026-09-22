/** Stored grades remain rise/run percentages; only presentation uses degrees. */
export const slopeDegrees = (percent: number) => Math.atan(percent / 100) * 180 / Math.PI;
export const formatSlope = (percent: number | null) => percent === null || !Number.isFinite(percent) ? '数据不足' : `${slopeDegrees(percent).toFixed(1)}°`;
