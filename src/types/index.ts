export type GameStatus = 'LOBBY' | 'SETUP' | 'PLAYING' | 'FINISHED';

export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  board: number[];
  checkedIndices: number[]; // Index kotak yang sudah dicoret (0-24)
  created_at: string; // Timestamp saat pemain dibuat
}

export interface GameState {
  roomId: string | null;
  status: GameStatus;
  players: Player[];
  currentPlayerTurnId: string | null;
  numbersPicked: number[];
  winnerId: string | null;
}