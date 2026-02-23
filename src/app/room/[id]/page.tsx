"use client";

import { use, useEffect, useMemo, useState } from "react";
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
    players, updatePlayers, localPlayerId, playerName, numbersPicked,
    setNumbersPicked, winnerId, setWinner, currentPlayerTurnId
  } = useGameStore();

  const [isUpdating, setIsUpdating] = useState(false);

  // 1. Kalkulasi Progress BINGO (Progress Bar B-I-N-G-O)
  const linesCount = useMemo(() => {
    const checkedIndices = board
      .map((num, idx) => (numbersPicked.includes(num as number) ? idx : -1))
      .filter((idx) => idx !== -1);
    return checkBingoLines(checkedIndices);
  }, [board, numbersPicked]);

  // 2. Sinkronisasi Data & Realtime (CamelCase Match)
  useEffect(() => {
    if (!localPlayerId) {
      router.push("/");
      return;
    }

    const fetchRoomData = async () => {
      // Fetch Players - Menggunakan kolom "isReady" (CamelCase)
      const { data: pData } = await supabase
        .from("players")
        .select('id, name, "isReady", board, created_at')
        .eq("room_id", roomId)
        .order("created_at", { ascending: true });
      
      if (pData) updatePlayers(pData);

      // Fetch Room - Menggunakan kolom CamelCase sesuai SQL terakhir
      const { data: rData } = await supabase
        .from("rooms")
        .select('status, "numbersPicked", "winnerId", "currentPlayerTurnId"')
        .eq("id", roomId)
        .single();

      if (rData) {
        setNumbersPicked(rData.numbersPicked || []);
        if (rData.status !== status) setGameStatus(rData.status);
        if (rData.winnerId) setWinner(rData.winnerId);
        // Sync turn ke store
        useGameStore.setState({ currentPlayerTurnId: rData.currentPlayerTurnId });
      }
    };

    const initSync = async () => {
      // Pastikan data player terdaftar/update di DB
      await supabase.from("players").upsert({
        id: localPlayerId,
        room_id: roomId,
        name: playerName,
      });
      await fetchRoomData();
    };

    // Subskripsi Realtime untuk Player dan Room
    const channel = supabase
      .channel(`room-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, () => fetchRoomData())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, (payload) => {
        // Sinkronisasi state dari payload realtime
        setNumbersPicked(payload.new.numbersPicked || []);
        setGameStatus(payload.new.status);
        if (payload.new.winnerId) setWinner(payload.new.winnerId);
        useGameStore.setState({ currentPlayerTurnId: payload.new.currentPlayerTurnId });
      })
      .subscribe();

    initSync();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, localPlayerId, router]);

  // 3. Cek Kemenangan Otomatis
  useEffect(() => {
    if (linesCount >= 5 && status === "PLAYING" && !winnerId) {
      supabase.from("rooms")
        .update({ winnerId: localPlayerId, status: "FINISHED" })
        .eq("id", roomId)
        .then();
    }
  }, [linesCount, status, winnerId, localPlayerId, roomId]);

  // 4. Handler "Saya Siap"
  const handleReady = async () => {
    if (!localPlayerId || isUpdating) return;
    setIsUpdating(true);

    const isFull = board.filter(n => n !== null).length === 25;
    const finalBoard = isFull ? board : Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

    try {
      // Update status isReady ke database
      await supabase.from("players")
        .update({ isReady: true, board: finalBoard })
        .eq("id", localPlayerId);

      // Cek apakah semua pemain sudah siap
      const { data: allP } = await supabase.from("players").select('id, "isReady"').eq("room_id", roomId);
      
      if (allP && allP.every(p => p.isReady)) {
        // Ambil player pertama berdasarkan waktu join (created_at) untuk giliran awal
        const { data: first } = await supabase.from("players")
          .select("id")
          .eq("room_id", roomId)
          .order("created_at", { ascending: true })
          .limit(1)
          .single();

        await supabase.from("rooms").update({ 
          status: "PLAYING",
          currentPlayerTurnId: first?.id 
        }).eq("id", roomId);
      }
    } catch (err) {
      console.error("Gagal update status siap:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  // 5. Handler Klik Angka (Logika Giliran)
  const handleCellClick = async (num: number, index: number) => {
    if (status === "LOBBY" || status === "SETUP") {
      fillCell(index);
    } else if (status === "PLAYING") {
      // VALIDASI: Hanya eksekusi jika giliran pemain lokal
      if (currentPlayerTurnId !== localPlayerId) return;
      if (numbersPicked.includes(num)) return;

      const newPicked = [...numbersPicked, num];
      
      // Kalkulasi pemain berikutnya berdasarkan urutan join
      const sortedPlayers = [...players].sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      const myIdx = sortedPlayers.findIndex(p => p.id === localPlayerId);
      const nextId = sortedPlayers[(myIdx + 1) % sortedPlayers.length].id;

      // Update angka global dan pindahkan giliran
      await supabase.from("rooms").update({ 
        numbersPicked: newPicked,
        currentPlayerTurnId: nextId 
      }).eq("id", roomId);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white p-4 font-sans selection:bg-pink-500/30">
      
      {/* Sidebar - Daftar Pemain Online */}
      <div className="fixed top-4 left-4 z-10 hidden lg:block w-52 space-y-2">
        <p className="text-[10px] font-black opacity-30 uppercase tracking-[0.2em] px-2">Live Players</p>
        <div className="space-y-1">
          {players.map((p) => (
            <div key={p.id} className="bg-white/5 border border-white/10 p-3 rounded-2xl flex items-center gap-3 backdrop-blur-md">
              <div className={`w-2 h-2 rounded-full ${p.isReady ? "bg-green-500 shadow-[0_0_10px_#22c55e]" : "bg-yellow-500 animate-pulse"}`} />
              <span className={`text-sm truncate ${p.id === localPlayerId ? "text-pink-400 font-bold" : "text-white/70"}`}>
                {p.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-md mx-auto pt-6 flex flex-col items-center">
        
        {/* B-I-N-G-O Progress Letters */}
        <div className="flex gap-3 mb-8">
          {"BINGO".split("").map((letter, i) => (
            <div 
              key={i} 
              className={`w-12 h-12 flex items-center justify-center rounded-2xl text-2xl font-black transition-all duration-500 border
                ${linesCount > i 
                  ? "bg-pink-600 border-pink-400 shadow-[0_0_20px_rgba(236,72,153,0.4)] scale-110" 
                  : "bg-white/5 border-white/5 opacity-20"}`}
            >
              {letter}
            </div>
          ))}
        </div>

        {/* Turn Indicator */}
        {status === "PLAYING" && !winnerId && (
          <div className="mb-6 px-6 py-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-sm font-bold shadow-xl">
            {currentPlayerTurnId === localPlayerId ? (
              <span className="text-green-400 animate-pulse">✨ GILIRAN KAMU! Pilih angka...</span>
            ) : (
              <span className="text-white/40">
                Menunggu <span className="text-white">{players.find(p => p.id === currentPlayerTurnId)?.name}</span>...
              </span>
            )}
          </div>
        )}

        {/* Room Box Info */}
        <div className="w-full bg-white/5 border border-white/10 p-5 rounded-3xl flex justify-between items-center mb-8 shadow-2xl backdrop-blur-sm">
          <div>
            <p className="text-[10px] text-pink-500 font-black uppercase tracking-widest">Arena Code</p>
            <p className="text-2xl font-mono font-bold">{roomId}</p>
          </div>
          {status === "PLAYING" ? (
            <div className="px-4 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded-full text-xs font-black tracking-widest animate-pulse">LIVE GAME</div>
          ) : (
            <Timer duration={30} onTimeUp={handleReady} />
          )}
        </div>

        {/* Grid Bingo 5x5 */}
        <div className="grid grid-cols-5 gap-3 w-full aspect-square mb-8">
          {board.map((num, index) => {
            const isPicked = numbersPicked.includes(num as number);
            return (
              <button 
                key={index} 
                onClick={() => handleCellClick(num as number, index)} 
                disabled={status === "FINISHED" || (status === "PLAYING" && currentPlayerTurnId !== localPlayerId)}
                className={`relative aspect-square flex items-center justify-center text-xl font-black rounded-2xl border transition-all duration-300 transform active:scale-90
                  ${isPicked 
                    ? "bg-pink-600 border-pink-400 shadow-inner" 
                    : num 
                      ? "bg-indigo-600 border-indigo-400 text-white" 
                      : "bg-white/5 border-white/10 text-white/10 hover:border-white/20"}`}
              >
                {num}
                {isPicked && (
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center text-4xl opacity-30 select-none">✕</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer Actions */}
        {status !== "PLAYING" && status !== "FINISHED" && (
          <div className="flex gap-4 w-full">
            <button 
              onClick={randomizeBoard} 
              className="flex-1 py-4 bg-white/5 border border-white/10 rounded-2xl font-bold hover:bg-white/10 transition-all active:scale-95"
            >
              Acak
            </button>
            <button 
              onClick={handleReady} 
              disabled={isUpdating}
              className="flex-[2] py-4 rounded-2xl font-black bg-gradient-to-r from-pink-600 to-rose-500 shadow-xl shadow-pink-900/20 hover:from-pink-500 hover:to-rose-400 transition-all active:scale-95 disabled:opacity-50"
            >
              {isUpdating ? "MENGIRIM..." : "SAYA SIAP"}
            </button>
          </div>
        )}
      </div>

      {/* Fullscreen Winner Overlay */}
      {winnerId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f172a]/95 backdrop-blur-xl">
          <div className="text-center p-10 animate-in fade-in zoom-in duration-500">
            <h1 className="text-8xl font-black text-yellow-400 mb-4 drop-shadow-[0_0_30px_rgba(250,204,21,0.4)]">BINGO!</h1>
            <p className="text-2xl font-bold text-white mb-10">
              🏆 {players.find(p => p.id === winnerId)?.name || "Pemain"} Juara!
            </p>
            <button 
              onClick={() => window.location.href = '/'} 
              className="px-12 py-4 bg-pink-600 hover:bg-pink-500 rounded-full font-black tracking-widest transition-all shadow-2xl shadow-pink-600/40"
            >
              MAIN LAGI
            </button>
          </div>
        </div>
      )}
    </div>
  );
}