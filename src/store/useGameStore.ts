import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GameState, GameStatus, Player } from '@/types';

interface GameStore extends GameState {
  // --- State Tambahan ---
  board: (number | null)[];
  localPlayerId: string | null;
  playerName: string; // Menyimpan nama user lokal

  // --- Actions ---
  setPlayerInfo: (name: string) => void; // Gabungan set nama & ID
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

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      // --- Initial State ---
      roomId: null,
      status: 'LOBBY',
      players: [],
      currentPlayerTurnId: null,
      numbersPicked: [],
      winnerId: null,
      board: Array(25).fill(null),
      localPlayerId: null,
      playerName: "",

      // --- Actions ---

      // Fungsi krusial: Membuat ID hanya jika belum punya
      setPlayerInfo: (name: string) => set((state) => {
        const existingId = state.localPlayerId;
        const newId = existingId || Math.random().toString(36).substring(2, 9);
        
        return {
          localPlayerId: newId,
          playerName: name,
          // Inisialisasi list players lokal dengan diri sendiri
          players: [{ 
            id: newId, 
            name, 
            isHost: false, 
            isReady: false, 
            board: [], 
            checkedIndices: [],
            created_at: new Date().toISOString()
          }]
        };
      }),

      setRoomId: (id: string) => set({ roomId: id }),

      setGameStatus: (status: GameStatus) => set({ status }),

      setBoard: (newBoard) => set({ board: newBoard }),

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

      setNumbersPicked: (numbers: number[]) => set({ numbersPicked: numbers }),

      updatePlayers: (players: Player[]) => set({ players }),

      setWinner: (winnerId: string) => set({ winnerId, status: 'FINISHED' }),

      resetGame: () => set({
        status: 'LOBBY',
        numbersPicked: [],
        winnerId: null,
        currentPlayerTurnId: null,
        board: Array(25).fill(null)
      }),
    }),
    {
      name: 'bingo-storage', // Data disimpan di LocalStorage browser
      partialize: (state) => ({ 
        localPlayerId: state.localPlayerId, 
        playerName: state.playerName 
      }), // Hanya simpan ID dan Nama agar tidak konflik saat ganti room
    }
  )
);