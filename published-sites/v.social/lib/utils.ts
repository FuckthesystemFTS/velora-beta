import { clsx, type ClassValue } from "clsx";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function relativeTime(date: Date | string) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: it });
}

export function initials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function thresholdFor(total: number) {
  return Math.floor(total / 2) + 1;
}

export function pick<T>(items: T[], count: number) {
  return items.slice(0, count);
}
