"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/store/useGameStore";
import { supabase } from "@/lib/supabase";

export default function Lobby() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(""); // Mengganti alert dengan UI Error modern
  
  const { setPlayerInfo, setRoomId } = useGameStore();
  const router = useRouter();

  const handleCreateRoom = async () => {
    setErrorMsg("");
    if (!name.trim()) return setErrorMsg("Nama pemain wajib diisi.");
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

      setPlayerInfo(name.trim());
      setRoomId(newRoomId);
      router.push(`/room/${newRoomId}`);
    } catch (error: any) {
      console.error(error);
      setErrorMsg("Koneksi server terputus. Gagal membuat arena.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    setErrorMsg("");
    if (!name.trim()) return setErrorMsg("Nama pemain wajib diisi.");
    if (!roomCode.trim() || roomCode.length < 5) return setErrorMsg("Kode arena tidak valid.");
    
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

      setPlayerInfo(name.trim());
      setRoomId(roomCode.toUpperCase());
      router.push(`/room/${roomCode.toUpperCase()}`);
    } catch (error: any) {
      console.error(error);
      setErrorMsg("Koneksi server terputus. Gagal bergabung.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-[#070B14] text-slate-200 p-4 font-sans relative overflow-hidden">
      
      {/* --- Ambient Background Glows --- */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[30rem] h-[30rem] bg-rose-600/10 rounded-full blur-[150px] pointer-events-none"></div>

      <div className="w-full max-w-[420px] relative z-10">
        
        {/* --- Header / Logo --- */}
        <div className="text-center mb-10 space-y-2">
          <div className="inline-flex items-center justify-center p-3 bg-white/5 rounded-2xl mb-2 border border-white/5 ring-1 ring-white/10 shadow-[0_0_30px_rgba(79,70,229,0.15)]">
            <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-white">
            BINGO<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-rose-400">55</span>
          </h1>
          <p className="text-sm font-medium text-slate-500 uppercase tracking-[0.2em]">Multiplayer Arena</p>
        </div>

        {/* --- Main Card --- */}
        <div className="bg-[#0B1120]/80 backdrop-blur-2xl p-6 sm:p-8 rounded-[2rem] shadow-2xl border border-slate-800/60 relative">
          
          {/* Garis atas dekoratif */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-[2px] bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>

          <div className="space-y-6">
            
            {/* Error Notifier Modern */}
            {errorMsg && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-medium">{errorMsg}</p>
              </div>
            )}

            {/* Input Identitas */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400 ml-1">Callsign / Nama</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Masukkan namamu..."
                  disabled={isLoading}
                  className="w-full bg-[#0F172A] border border-slate-700/50 rounded-2xl pl-11 pr-4 py-4 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-white placeholder:text-slate-600 font-medium"
                />
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-4">
              
              {/* Tombol Buat Room */}
              <button
                onClick={handleCreateRoom}
                disabled={isLoading}
                className="group relative w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl transition-all duration-300 active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 overflow-hidden"
              >
                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
                <div className="flex items-center justify-center gap-2">
                  {isLoading ? (
                    <span className="animate-pulse">Menghubungkan...</span>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                      </svg>
                      <span>Buat Arena Baru</span>
                    </>
                  )}
                </div>
              </button>

              {/* Pemisah */}
              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-slate-800"></div>
                <span className="flex-shrink-0 mx-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Atau Gabung</span>
                <div className="flex-grow border-t border-slate-800"></div>
              </div>

              {/* Input Gabung Room */}
              <div className="flex gap-2 sm:gap-3">
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="KODE"
                  disabled={isLoading}
                  maxLength={5}
                  className="w-1/3 bg-[#0F172A] border border-slate-700/50 rounded-2xl px-2 py-4 text-center font-mono text-lg font-bold focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all uppercase placeholder:text-slate-600 text-white"
                />
                <button
                  onClick={handleJoinRoom}
                  disabled={isLoading}
                  className="w-2/3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-4 rounded-2xl transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <span>Join Arena</span>
                  <svg className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>

            </div>
          </div>
        </div>
        
        {/* --- Footer Kredensial --- */}
        <div className="mt-8 text-center flex flex-col items-center gap-1">
          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-semibold tracking-widest uppercase">
            <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e] animate-pulse"></span>
            Server Online
          </div>
        </div>

      </div>
    </main>
  );
}