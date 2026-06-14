import type { Frequency } from "./types";

export const DAYS_PER_YEAR = 365.2425;

export function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || toIsoDate(date) !== value) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return date;
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function elapsedYears(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 86_400_000 / DAYS_PER_YEAR;
}

export function addStep(date: Date, frequency: Frequency): Date {
  switch (frequency) {
    case "daily":
      return addDays(date, 1);
    case "weekly":
      return addDays(date, 7);
    case "monthly":
    case "irregular":
      return addMonths(date, 1);
  }
}

export function addYears(date: Date, years: number): Date {
  const next = new Date(date.getTime());
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

export function detectFrequency(dates: Date[]): {
  frequency: Frequency;
  deltas: number[];
  maxGapDays: number;
  unusualGapCount: number;
} {
  if (dates.length < 2) {
    return {
      frequency: "irregular",
      deltas: [],
      maxGapDays: 0,
      unusualGapCount: 0,
    };
  }

  const deltas = dates.slice(1).map((date, index) => dayDiff(dates[index], date));
  const median = medianNumber(deltas);
  const frequency = frequencyFromMedianDelta(median);
  const maxGapDays = Math.max(...deltas);
  const unusualGapCount = deltas.filter((delta) => isUnusualGap(delta, frequency)).length;

  return { frequency, deltas, maxGapDays, unusualGapCount };
}

function frequencyFromMedianDelta(medianDelta: number): Frequency {
  if (medianDelta <= 3) {
    return "daily";
  }
  if (medianDelta >= 5 && medianDelta <= 9) {
    return "weekly";
  }
  if (medianDelta >= 25 && medianDelta <= 35) {
    return "monthly";
  }
  return "irregular";
}

function isUnusualGap(delta: number, frequency: Frequency): boolean {
  switch (frequency) {
    case "daily":
      return delta > 5;
    case "weekly":
      return delta > 10;
    case "monthly":
      return delta < 20 || delta > 45;
    case "irregular":
      return false;
  }
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  const originalDate = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(originalDate, lastDay));
  return next;
}

function dayDiff(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function medianNumber(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}
