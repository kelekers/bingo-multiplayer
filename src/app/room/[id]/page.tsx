"use client";

import { use, useEffect, useMemo } from "react";
import { useGameStore } from "@/store/useGameStore";
import Timer from "@/components/game/Timer";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { checkBingoLines } from "@/lib/bingo-logic";

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const roomId = resolvedParams.id;
  const router = useRouter();

  const {
    board, fillCell, randomizeBoard, status, setGameStatus,
    players, updatePlayers, localPlayerId, numbersPicked,
    setNumbersPicked, winnerId, setWinner,
  } = useGameStore();

  const linesCount = useMemo(() => {
    const checkedIndices = board
      .map((num, idx) => (numbersPicked.includes(num as number) ? idx : -1))
      .filter((idx) => idx !== -1);
    return checkBingoLines(checkedIndices);
  }, [board, numbersPicked]);

  // 1. Sinkronisasi & AUTO-JOIN
  useEffect(() => {
    if (!localPlayerId) {
      router.push("/");
      return;
    }

    const initSync = async () => {
      // A. Pastikan Player sudah terdaftar di DB (UPSERT)
      // Ini bagian yang tadi hilang!
      const playerName = useGameStore.getState().players[0]?.name || "Anonymous";
      await supabase.from("players").upsert({
        id: localPlayerId,
        room_id: roomId,
        name: playerName,
      });

      // B. Ambil data awal pemain
      const { data: pData } = await supabase.from("players").select("*").eq("room_id", roomId);
      if (pData) updatePlayers(pData);

      // C. Ambil data awal room
      const { data: rData } = await supabase.from("rooms").select("numbers_picked, status, winner_id").eq("id", roomId).single();
      if (rData) {
        setNumbersPicked(rData.numbers_picked || []);
        if (rData.status !== status) setGameStatus(rData.status);
        if (rData.winner_id) setWinner(rData.winner_id);
      }
    };

    const playerChannel = supabase
      .channel("player_sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, () => initSync())
      .subscribe();

    const roomChannel = supabase
      .channel("room_sync")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, (payload) => {
        setNumbersPicked(payload.new.numbers_picked || []);
        if (payload.new.status !== status) setGameStatus(payload.new.status);
        if (payload.new.winner_id) setWinner(payload.new.winner_id);
      })
      .subscribe();

    initSync();
    return () => {
      supabase.removeChannel(playerChannel);
      supabase.removeChannel(roomChannel);
    };
  }, [roomId, localPlayerId, router]);

  // 2. Cek Kemenangan
  useEffect(() => {
    if (linesCount >= 5 && status === "PLAYING" && !winnerId) {
      supabase.from("rooms").update({ winner_id: localPlayerId, status: "FINISHED" }).eq("id", roomId).then();
    }
  }, [linesCount, status, winnerId, localPlayerId, roomId]);

  const handleReady = async () => {
    if (!localPlayerId) return;
    
    const finalBoard = board.filter(n => n !== null).length === 25 ? board : Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

    // Update Status Ready ke DB
    const { error } = await supabase
      .from("players")
      .update({ isReady: true, board: finalBoard })
      .eq("id", localPlayerId);

    if (error) {
      alert("Gagal update status! Pastikan RLS di Supabase sudah OFF.");
      console.error(error);
      return;
    }

    // Cek jika semua pemain sudah ready
    const { data: allP } = await supabase.from("players").select("isReady").eq("room_id", roomId);
    if (allP && allP.length > 0 && allP.every(p => p.isReady)) {
      await supabase.from("rooms").update({ status: "PLAYING" }).eq("id", roomId);
    }
  };

  const handleCellClick = async (num: number, index: number) => {
    if (status === "SETUP" || status === "LOBBY") {
      fillCell(index);
    } else if (status === "PLAYING") {
      if (numbersPicked.includes(num)) return;
      const newPicked = [...numbersPicked, num];
      await supabase.from("rooms").update({ numbers_picked: newPicked }).eq("id", roomId);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white p-4 font-sans">
      {/* Sidebar - Cek isReady di sini */}
      <div className="fixed top-4 left-4 z-10 hidden lg:block w-48 space-y-2">
        <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest px-2">Pemain Online</p>
        {players.map((p) => (
          <div key={p.id} className="bg-white/5 border border-white/10 p-3 rounded-xl flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${p.isReady ? "bg-green-500 shadow-[0_0_10px_green]" : "bg-yellow-500 animate-pulse"}`} />
            <span className={`text-sm truncate ${p.id === localPlayerId ? "text-pink-400 font-bold" : ""}`}>{p.name}</span>
          </div>
        ))}
      </div>

      {/* Konten Utama */}
      <div className="max-w-md mx-auto pt-6 flex flex-col items-center">
        {/* B-I-N-G-O Progress */}
        <div className="flex gap-3 mb-8">
          {"BINGO".split("").map((letter, i) => (
            <div key={i} className={`w-12 h-12 flex items-center justify-center rounded-xl text-2xl font-black transition-all ${linesCount > i ? "bg-pink-600 shadow-lg scale-110" : "bg-white/5 opacity-20"}`}>{letter}</div>
          ))}
        </div>

        {/* Room Box */}
        <div className="w-full bg-white/5 border border-white/10 p-4 rounded-2xl flex justify-between items-center mb-8">
          <div><p className="text-xs text-pink-500 font-bold uppercase">Room Code</p><p className="text-xl font-mono">{roomId}</p></div>
          {status === "PLAYING" ? <div className="text-green-400 font-bold animate-pulse">LIVE</div> : <Timer duration={30} onTimeUp={handleReady} />}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-5 gap-3 w-full aspect-square">
          {board.map((num, index) => {
            const isPicked = numbersPicked.includes(num as number);
            return (
              <button key={index} onClick={() => handleCellClick(num as number, index)} disabled={status === "FINISHED"} className={`relative aspect-square flex items-center justify-center text-xl font-bold rounded-xl border transition-all ${isPicked ? "bg-pink-600 border-pink-400" : num ? "bg-indigo-600 border-indigo-400" : "bg-white/5 border-white/10 text-white/20"}`}>
                {num}
                {isPicked && <div className="absolute inset-0 bg-black/20 flex items-center justify-center text-3xl">✕</div>}
              </button>
            );
          })}
        </div>

        {/* Tombol Siap */}
        {status !== "PLAYING" && (
          <div className="mt-8 flex gap-4 w-full">
            <button onClick={randomizeBoard} className="flex-1 py-4 bg-white/5 border border-white/10 rounded-2xl">Acak</button>
            <button onClick={handleReady} className="flex-[2] py-4 rounded-2xl font-bold bg-gradient-to-r from-pink-600 to-rose-500 shadow-lg">SAYA SIAP</button>
          </div>
        )}
      </div>

      {/* Overlay Menang */}
      {winnerId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
          <div className="text-center">
            <h1 className="text-6xl font-black text-yellow-400 mb-2">BINGO!</h1>
            <p className="text-2xl">{players.find(p => p.id === winnerId)?.name} Menang!</p>
            <button onClick={() => window.location.href = '/'} className="mt-8 px-10 py-3 bg-pink-600 rounded-full font-bold">Keluar</button>
          </div>
        </div>
      )}
    </div>
  );
}