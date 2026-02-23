"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/store/useGameStore";
import { supabase } from "@/lib/supabase";

export default function Lobby() {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const { setPlayerName, setRoomId } = useGameStore();
  const router = useRouter();

  const handleCreateRoom = async () => {
    if (!name) return alert("Masukkan nama dulu!");
    const newRoomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    
    // SIMPAN KE DATABASE DULU SEBELUM PINDAH HALAMAN
    const { error } = await supabase
      .from('rooms')
      .insert([{ id: newRoomId, status: 'LOBBY', numbers_picked: [] }]);

    if (error) {
      console.error(error);
      return alert("Gagal membuat room!");
    }

    // Barulah simpan di store dan pindah
    setPlayerName(name);
    setRoomId(newRoomId);
    router.push(`/room/${newRoomId}`);
  };

  const handleJoinRoom = () => {
    if (!name || !roomCode) return alert("Nama dan Kode Room wajib diisi!");
    setPlayerName(name);
    setRoomId(roomCode);
    router.push(`/room/${roomCode}`);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 p-4">
      <div className="bg-white/10 backdrop-blur-lg p-8 rounded-2xl shadow-2xl border border-white/20 w-full max-w-md text-white">
        <h1 className="text-4xl font-extrabold text-center mb-8 tracking-tight">
          BINGO <span className="text-pink-400">5X5</span>
        </h1>

        <div className="space-y-6">
          {/* Input Nama */}
          <div>
            <label className="block text-sm font-medium mb-2 opacity-80">Nama Pemain</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Sang Juara"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pink-500 transition-all"
            />
          </div>

          <div className="flex flex-col gap-4">
            <button
              onClick={handleCreateRoom}
              className="w-full bg-pink-600 hover:bg-pink-500 text-white font-bold py-3 rounded-lg shadow-lg transform active:scale-95 transition-all"
            >
              Buat Room Baru
            </button>

            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-white/10"></span></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-transparent px-2 opacity-50">Atau Gabung Room</span></div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="KODE"
                className="w-1/3 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleJoinRoom}
                className="w-2/3 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold py-3 rounded-lg transition-all"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}