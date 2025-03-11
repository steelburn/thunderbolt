import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Converts a v7 UUID string to a Date object
 * High-performance implementation that avoids regex and minimizes string operations
 * @param uuid - A v7 UUID string
 * @returns Date object representing the timestamp encoded in the UUID
 */
export function uuidToDate(uuid: string): Date {
  // UUID v7 format: <36-bit timestamp><84-bit random>
  // The timestamp is the first 36 bits (first 9 characters after removing hyphens)

  // Extract and combine the timestamp parts directly without regex
  // Format: xxxxxxxx-xxxx-...
  const timestampHex = uuid.substring(0, 8) + uuid.substring(9, 10)

  // Convert hex to decimal (milliseconds since Unix epoch)
  // Using parseInt with radix 16 for hex conversion
  const timestampMs = parseInt(timestampHex, 16)

  // Create and return the Date object directly
  return new Date(timestampMs)
}
