"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/store/useGameStore";
import { supabase } from "@/lib/supabase";

export default function Lobby() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  
  // Menggunakan setPlayerInfo sesuai revisi Store terbaru
  const { setPlayerInfo, setRoomId } = useGameStore();
  const router = useRouter();

  const handleCreateRoom = async () => {
    if (!name) return alert("Masukkan nama dulu!");
    setIsLoading(true);

    try {
      // 1. Generate Room ID Unik
      const newRoomId = Math.random().toString(36).substring(2, 7).toUpperCase();
      
      // 2. Simpan Room ke Supabase
      const { error: roomError } = await supabase
        .from('rooms')
        .insert([{ 
          id: newRoomId, 
          status: 'LOBBY', 
          numbersPicked: [] 
        }]);

      if (roomError) throw roomError;

      // 3. Set identitas pemain di Store (ID unik device dibuat di sini)
      setPlayerInfo(name);
      setRoomId(newRoomId);

      // 4. Pindah ke halaman room
      router.push(`/room/${newRoomId}`);
    } catch (error: any) {
      console.error(error);
      alert("Gagal membuat room: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (!name || !roomCode) return alert("Nama dan Kode Room wajib diisi!");
    setIsLoading(true);

    try {
      // 1. Cek apakah room tersebut ada di database
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('id')
        .eq('id', roomCode)
        .single();

      if (roomError || !roomData) {
        alert("Room tidak ditemukan! Periksa kembali kodenya.");
        return;
      }

      // 2. Set identitas pemain di Store
      setPlayerInfo(name);
      setRoomId(roomCode);

      // 3. Pindah ke halaman room
      router.push(`/room/${roomCode}`);
    } catch (error: any) {
      console.error(error);
      alert("Gagal bergabung ke room.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0f172a] bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-900 to-slate-900 p-4">
      <div className="bg-white/5 backdrop-blur-xl p-8 rounded-3xl shadow-2xl border border-white/10 w-full max-w-md text-white">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-black tracking-tighter mb-2 italic">
            BINGO<span className="text-pink-500 not-italic">55</span>
          </h1>
          <p className="text-white/40 text-sm font-medium tracking-widest uppercase">Multiplayer Arena</p>
        </div>

        <div className="space-y-6">
          {/* Input Nama */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-pink-500 ml-1">Identity</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Masukkan namamu..."
              disabled={isLoading}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:bg-white/10 transition-all placeholder:text-white/20"
            />
          </div>

          <div className="flex flex-col gap-4">
            <button
              onClick={handleCreateRoom}
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-500 hover:to-rose-400 text-white font-bold py-4 rounded-2xl shadow-lg shadow-pink-900/20 transform active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {isLoading ? "Memproses..." : "Buat Room Baru"}
            </button>

            <div className="relative py-4 flex items-center">
              <div className="flex-grow border-t border-white/5"></div>
              <span className="flex-shrink mx-4 text-[10px] font-bold text-white/20 uppercase tracking-[0.3em]">Atau Gabung</span>
              <div className="flex-grow border-t border-white/5"></div>
            </div>

            <div className="flex gap-3">
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="KODE"
                disabled={isLoading}
                maxLength={5}
                className="w-1/3 bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-center font-mono font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all uppercase placeholder:text-white/10"
              />
              <button
                onClick={handleJoinRoom}
                disabled={isLoading}
                className="w-2/3 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold py-4 rounded-2xl transition-all active:scale-[0.98] disabled:opacity-50"
              >
                Join Arena
              </button>
            </div>
          </div>
        </div>
        
        <p className="mt-10 text-center text-[10px] text-white/20 font-medium tracking-widest uppercase">
          Powered by Supabase Realtime
        </p>
      </div>
    </main>
  );
}