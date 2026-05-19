import React from 'react';
import { View } from 'react-native';

/**
 * Mobile port of `rowie-vendor/components/tables/TableSeats.tsx`.
 *
 * Renders a ring of capacity seat dots around a table shape. Coordinates are
 * emitted relative to the table's top-left corner; the caller is responsible
 * for positioning the wrapper such that there's enough outer padding
 * (`SEAT_WRAPPER_PAD`) for the seats to sit outside the shape.
 *
 * Seat-placement math is intentionally identical to the vendor implementation
 * so a table looks the same on the phone POS and the web dashboard.
 */

export const SEAT_SIZE = 8;
export const SEAT_GAP = 4;
export const SEAT_WRAPPER_PAD = SEAT_SIZE + SEAT_GAP;

export interface SeatPosition {
  x: number;
  y: number;
  shape: 'round' | 'square';
}

export function getSeatPositions(
  shape: 'circle' | 'square' | 'rectangle',
  width: number,
  height: number,
  capacity: number
): SeatPosition[] {
  if (capacity <= 0) return [];

  if (shape === 'circle') {
    const cx = width / 2;
    const cy = height / 2;
    const a = width / 2 + SEAT_GAP + SEAT_SIZE / 2;
    const b = height / 2 + SEAT_GAP + SEAT_SIZE / 2;
    const result: SeatPosition[] = [];
    for (let i = 0; i < capacity; i++) {
      const angle = (Math.PI * 2 * i) / capacity - Math.PI / 2;
      result.push({
        x: cx + Math.cos(angle) * a,
        y: cy + Math.sin(angle) * b,
        shape: 'round',
      });
    }
    return result;
  }

  const perimeter = 2 * (width + height);
  const step = perimeter / capacity;
  const result: SeatPosition[] = [];
  let walked = step / 2;
  const offset = SEAT_GAP + SEAT_SIZE / 2;

  for (let i = 0; i < capacity; i++) {
    let x: number;
    let y: number;
    let pos = walked;

    if (pos < width) {
      x = pos;
      y = -offset;
    } else if ((pos -= width) < height) {
      x = width + offset;
      y = pos;
    } else if ((pos -= height) < width) {
      x = width - pos;
      y = height + offset;
    } else {
      pos -= width;
      x = -offset;
      y = height - pos;
    }
    result.push({ x, y, shape: 'square' });
    walked += step;
  }
  return result;
}

interface TableSeatsProps {
  shape: 'circle' | 'square' | 'rectangle';
  width: number;
  height: number;
  capacity: number;
  color: string;
  opacity?: number;
}

export function TableSeats({
  shape,
  width,
  height,
  capacity,
  color,
  opacity = 0.7,
}: TableSeatsProps) {
  const clamped = Math.min(Math.max(capacity || 0, 0), 16);
  const positions = getSeatPositions(shape, width, height, clamped);
  return (
    <>
      {positions.map((pos, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: SEAT_WRAPPER_PAD + pos.x - SEAT_SIZE / 2,
            top: SEAT_WRAPPER_PAD + pos.y - SEAT_SIZE / 2,
            width: SEAT_SIZE,
            height: SEAT_SIZE,
            borderRadius: pos.shape === 'round' ? SEAT_SIZE / 2 : 2,
            backgroundColor: color,
            opacity,
          }}
        />
      ))}
    </>
  );
}
