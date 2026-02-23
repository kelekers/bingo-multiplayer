// src/lib/bingo-logic.ts

export const checkBingoLines = (checkedIndices: number[]): number => {
  let lines = 0;

  // Indeks kemenangan Bingo 5x5
  const winPatterns = [
    // Horizontal
    [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
    // Vertikal
    [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
    // Diagonal
    [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]
  ];

  winPatterns.forEach(pattern => {
    if (pattern.every(index => checkedIndices.includes(index))) {
      lines++;
    }
  });

  return lines;
};