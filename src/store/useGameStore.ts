// src/store/useGameStore.ts
import { create } from 'zustand';
import { GameState, GameStatus, Player } from '@/types';

interface GameStore extends GameState {
  // --- State Tambahan ---
  board: (number | null)[]; // Board 5x5 milik user lokal
  localPlayerId: string | null;

  // --- Actions ---
  setPlayerName: (name: string) => void;
  setRoomId: (id: string) => void;
  setGameStatus: (status: GameStatus) => void;
  setBoard: (newBoard: (number | null)[]) => void;
  fillCell: (index: number) => void;
  randomizeBoard: () => void;
  
  // Gameplay Actions
  setNumbersPicked: (numbers: number[]) => void;
  updatePlayers: (players: Player[]) => void;
  setWinner: (winnerId: string) => void;
  resetGame: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  // --- Initial State ---
  roomId: null,
  status: 'LOBBY',
  players: [],
  currentPlayerTurnId: null,
  numbersPicked: [],
  winnerId: null,
  board: Array(25).fill(null),
  localPlayerId: null,

  // --- Actions ---

  // 1. Inisialisasi Player di awal
  setPlayerName: (name: string) => {
    const newId = Math.random().toString(36).substring(2, 9);
    set({
      localPlayerId: newId,
      // Kita set player pertama kali, detail lainnya akan diupdate oleh Supabase
      players: [{ 
        id: newId, 
        name, 
        isHost: false, 
        isReady: false, 
        board: [], 
        checkedIndices: [] 
      }]
    });
  },

  setRoomId: (id: string) => set({ roomId: id }),

  setGameStatus: (status: GameStatus) => set({ status }),

  setBoard: (newBoard) => set({ board: newBoard }),

  // 2. Logika Fase SETUP (Mengisi angka 1-25)
  fillCell: (index: number) => set((state) => {
    if (state.board[index] !== null) return state;

    const filledNumbers = state.board.filter((n): n is number => n !== null);
    const nextNumber = filledNumbers.length + 1;

    if (nextNumber > 25) return state;

    const newBoard = [...state.board];
    newBoard[index] = nextNumber;
    
    return { board: newBoard };
  }),

  randomizeBoard: () => {
    const shuffled = Array.from({ length: 25 }, (_, i) => i + 1)
      .sort(() => Math.random() - 0.5);
    set({ board: shuffled });
  },

  // 3. Logika Fase PLAYING (Sinkronisasi Real-time)
  
  // Update daftar angka yang sudah dipilih secara global (dari DB)
  setNumbersPicked: (numbers: number[]) => set({ numbersPicked: numbers }),

  // Update list pemain (untuk melihat siapa yang sudah ready atau siapa yang menang)
  updatePlayers: (players: Player[]) => set({ players }),

  setWinner: (winnerId: string) => set({ winnerId, status: 'FINISHED' }),

  // 4. Reset Game
  resetGame: () => set({
    status: 'LOBBY',
    numbersPicked: [],
    winnerId: null,
    currentPlayerTurnId: null,
    board: Array(25).fill(null)
  }),
}));