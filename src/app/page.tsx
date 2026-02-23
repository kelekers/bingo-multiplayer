"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/store/useGameStore";
import { supabase } from "@/lib/supabase";

export default function Lobby() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  
  const { setPlayerInfo, setRoomId } = useGameStore();
  const router = useRouter();

  // Fungsi untuk membersihkan memori dari game sebelumnya
  const resetPreviousGameState = () => {
    useGameStore.setState({
      board: Array(25).fill(null),
      status: 'LOBBY',
      numbersPicked: [],
      winnerId: null,
      currentPlayerTurnId: null,
      players: []
    });
  };

  const handleCreateRoom = async () => {
    setErrorMsg("");
    if (!name.trim()) return setErrorMsg("Silakan masukkan nama Anda.");
    setIsLoading(true);

    try {
      const newRoomId = Math.random().toString(36).substring(2, 7).toUpperCase();
      
      const { error: roomError } = await supabase
        .from('rooms')
        .insert([{ 
          id: newRoomId, 
          status: 'LOBBY', 
          numbersPicked: [] 
        }]);

      if (roomError) throw roomError;

      resetPreviousGameState(); // Bersihkan state sebelum masuk
      setPlayerInfo(name.trim());
      setRoomId(newRoomId);
      router.push(`/room/${newRoomId}`);
    } catch (error: any) {
      console.error(error);
      setErrorMsg("Koneksi gagal. Silakan coba lagi.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    setErrorMsg("");
    if (!name.trim()) return setErrorMsg("Silakan masukkan nama Anda.");
    if (!roomCode.trim() || roomCode.length < 5) return setErrorMsg("Kode Arena tidak valid.");
    
    setIsLoading(true);

    try {
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('id')
        .eq('id', roomCode.toUpperCase())
        .single();

      if (roomError || !roomData) {
        setErrorMsg("Arena tidak ditemukan. Periksa kembali kodemu.");
        setIsLoading(false);
        return;
      }

      resetPreviousGameState(); // Bersihkan state sebelum masuk
      setPlayerInfo(name.trim());
      setRoomId(roomCode.toUpperCase());
      router.push(`/room/${roomCode.toUpperCase()}`);
    } catch (error: any) {
      console.error(error);
      setErrorMsg("Gagal bergabung ke arena. Silakan coba lagi.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-slate-50 text-slate-900 p-4 sm:p-6 font-sans selection:bg-blue-100 selection:text-blue-900">
      
      <div className="w-full max-w-[400px] bg-white p-8 sm:p-10 rounded-[24px] shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-slate-100 relative">
        
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-50 text-blue-600 rounded-xl mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 mb-1">
            BINGO<span className="text-blue-600">55</span>
          </h1>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Multiplayer Arena
          </p>
        </div>

        <div className="space-y-6">
          
          {errorMsg && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl flex items-start gap-3 text-sm animate-in fade-in slide-in-from-top-2 duration-300">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="font-medium leading-tight">{errorMsg}</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 ml-1">
              Nama Pemain
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Masukkan namamu..."
              disabled={isLoading}
              className="w-full bg-slate-50/50 border border-slate-200 text-slate-900 rounded-xl px-4 py-3.5 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all placeholder:text-slate-400 font-medium disabled:opacity-50"
            />
          </div>

          <div className="pt-2 flex flex-col gap-5">
            
            <button
              onClick={handleCreateRoom}
              disabled={isLoading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3.5 rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm"
            >
              {isLoading ? (
                <svg className="w-5 h-5 animate-spin text-white/70" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              ) : (
                <>
                  <svg className="w-5 h-5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Buat Arena Baru
                </>
              )}
            </button>

            <div className="flex items-center gap-4 py-1">
              <div className="h-px bg-slate-100 flex-1"></div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Atau Gabung</span>
              <div className="h-px bg-slate-100 flex-1"></div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="KODE"
                disabled={isLoading}
                maxLength={5}
                className="w-1/3 bg-slate-50/50 border border-slate-200 rounded-xl px-2 py-3.5 text-center font-mono text-base font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all uppercase placeholder:text-slate-400 placeholder:font-sans placeholder:font-medium disabled:opacity-50"
              />
              <button
                onClick={handleJoinRoom}
                disabled={isLoading}
                className="w-2/3 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold py-3.5 rounded-xl transition-all duration-200 active:scale-[0.98] disabled:opacity-50 shadow-sm flex items-center justify-center gap-2"
              >
                Gabung Arena
                <svg className="w-4 h-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        
        <p className="mt-10 text-center text-[10px] text-slate-400 font-semibold tracking-wider flex items-center justify-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          SISTEM ONLINE
        </p>
      </div>
    </main>
  );
}