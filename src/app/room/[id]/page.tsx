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
  // State untuk memilih board siapa yang sedang dilihat (Default: Board Kita)
  const [viewingPlayerId, setViewingPlayerId] = useState<string | null>(null);

  useEffect(() => {
    if (localPlayerId) setViewingPlayerId(localPlayerId);
  }, [localPlayerId]);

  // Kalkulasi progress pemain yang sedang dilihat
  const activeBoard = useMemo(() => {
    return players.find(p => p.id === viewingPlayerId)?.board || [];
  }, [players, viewingPlayerId]);

  const activeLines = useMemo(() => {
    const indices = activeBoard
      .map((num, idx) => (numbersPicked.includes(num) ? idx : -1))
      .filter(idx => idx !== -1);
    return checkBingoLines(indices);
  }, [activeBoard, numbersPicked]);

  // --- LOGIKA SINKRONISASI (Sama seperti sebelumnya, pastikan fetch data board) ---
  useEffect(() => {
    if (!localPlayerId) {
      router.push("/");
      return;
    }

    const fetchRoomData = async () => {
      const { data: pData } = await supabase
        .from("players")
        .select('id, name, "isReady", board, created_at, "isHost", "checkedIndices"')
        .eq("room_id", roomId)
        .order("created_at", { ascending: true });
      
      if (pData) updatePlayers(pData);

      const { data: rData } = await supabase
        .from("rooms")
        .select('status, "numbersPicked", "winnerId", "currentPlayerTurnId"')
        .eq("id", roomId)
        .single();

      if (rData) {
        setNumbersPicked(rData.numbersPicked || []);
        if (rData.status !== status) setGameStatus(rData.status);
        if (rData.winnerId) setWinner(rData.winnerId);
        useGameStore.setState({ currentPlayerTurnId: rData.currentPlayerTurnId });
      }
    };

    const initSync = async () => {
      await supabase.from("players").upsert({ id: localPlayerId, room_id: roomId, name: playerName });
      await fetchRoomData();
    };

    const channel = supabase.channel(`room-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, () => fetchRoomData())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, (payload) => {
        setNumbersPicked(payload.new.numbersPicked || []);
        setGameStatus(payload.new.status);
        if (payload.new.winnerId) setWinner(payload.new.winnerId);
        useGameStore.setState({ currentPlayerTurnId: payload.new.currentPlayerTurnId });
      })
      .subscribe();

    initSync();
    return () => { supabase.removeChannel(channel); };
  }, [roomId, localPlayerId]);

  // --- HANDLERS ---
  const handleReady = async () => {
    if (!localPlayerId || isUpdating) return;
    setIsUpdating(true);
    const finalBoard = board.filter(n => n !== null).length === 25 ? board : Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

    await supabase.from("players").update({ isReady: true, board: finalBoard }).eq("id", localPlayerId);

    const { data: allP } = await supabase.from("players").select('id, "isReady"').eq("room_id", roomId);
    if (allP?.every(p => p.isReady)) {
      const { data: first } = await supabase.from("players").select("id").eq("room_id", roomId).order("created_at", { ascending: true }).limit(1).single();
      await supabase.from("rooms").update({ status: "PLAYING", currentPlayerTurnId: first?.id }).eq("id", roomId);
    }
    setIsUpdating(false);
  };

  const handleCellClick = async (num: number, index: number) => {
    if (status === "SETUP" || status === "LOBBY") fillCell(index);
    else if (status === "PLAYING" && currentPlayerTurnId === localPlayerId && viewingPlayerId === localPlayerId) {
      if (numbersPicked.includes(num)) return;
      const nextId = players[(players.findIndex(p => p.id === localPlayerId) + 1) % players.length].id;
      await supabase.from("rooms").update({ numbersPicked: [...numbersPicked, num], currentPlayerTurnId: nextId }).eq("id", roomId);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#020617] text-slate-200 flex flex-col font-sans overflow-hidden">
      
      {/* Top Navigation / Header */}
      <header className="p-4 flex justify-between items-center bg-slate-900/50 backdrop-blur-md border-b border-white/5">
        <div>
          <p className="text-[10px] font-black text-pink-500 uppercase tracking-widest">Arena Code</p>
          <p className="text-xl font-mono font-bold">{roomId}</p>
        </div>
        <div className="flex gap-1">
          {"BINGO".split("").map((l, i) => (
            <div key={i} className={`w-8 h-8 flex items-center justify-center rounded-lg font-black text-xs border transition-all ${activeLines > i ? "bg-pink-600 border-pink-400 shadow-lg shadow-pink-900/50" : "bg-white/5 border-white/5 opacity-30"}`}>{l}</div>
          ))}
        </div>
      </header>

      {/* Main Game Area */}
      <main className="flex-1 overflow-y-auto p-4 flex flex-col items-center">
        
        {/* Status & Turn Info */}
        <div className="w-full max-w-sm mb-4">
          {status === "PLAYING" ? (
            <div className={`text-center py-2 rounded-2xl border transition-all ${currentPlayerTurnId === localPlayerId ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-white/5 border-white/10 text-white/30"}`}>
              {currentPlayerTurnId === localPlayerId ? "🚀 GILIRAN KAMU!" : `⏳ Menunggu ${players.find(p => p.id === currentPlayerTurnId)?.name}...`}
            </div>
          ) : (
            <div className="flex justify-center"><Timer duration={30} onTimeUp={handleReady} /></div>
          )}
        </div>

        {/* The Grid - Responsive Size */}
        <div className="w-full max-w-[min(90vw,400px)] aspect-square grid grid-cols-5 gap-2 md:gap-3">
          {(viewingPlayerId === localPlayerId ? board : activeBoard).map((num, idx) => {
            const isPicked = numbersPicked.includes(num as number);
            const isMyBoard = viewingPlayerId === localPlayerId;

            return (
              <button
                key={idx}
                disabled={!isMyBoard || status === "FINISHED"}
                onClick={() => handleCellClick(num as number, idx)}
                className={`relative flex items-center justify-center text-lg md:text-2xl font-black rounded-xl md:rounded-2xl border transition-all transform active:scale-90
                  ${isPicked 
                    ? "bg-pink-600 border-pink-400 shadow-[inset_0_2px_10px_rgba(0,0,0,0.3)]" 
                    : isMyBoard 
                      ? "bg-indigo-600 border-indigo-500 text-white shadow-lg" 
                      : "bg-slate-800/50 border-slate-700 text-slate-500"}`}
              >
                {num}
                {isPicked && <span className="absolute text-4xl opacity-20 select-none">✕</span>}
              </button>
            );
          })}
        </div>

        {/* Action Buttons (Lobby/Setup Only) */}
        {status !== "PLAYING" && (
          <div className="mt-6 flex gap-3 w-full max-w-sm">
            <button onClick={randomizeBoard} className="flex-1 py-4 bg-white/5 border border-white/10 rounded-2xl font-bold active:bg-white/10 transition-all">Acak</button>
            <button onClick={handleReady} disabled={isUpdating} className="flex-[2] py-4 bg-gradient-to-r from-pink-600 to-rose-500 rounded-2xl font-black shadow-lg active:scale-95 transition-all disabled:opacity-50">SAYA SIAP</button>
          </div>
        )}
      </main>

      {/* Bottom Tabs - Android Style Player Switcher */}
      <footer className="bg-slate-900 border-t border-white/5 p-4 pb-8">
        <p className="text-[10px] font-bold text-white/20 uppercase tracking-[0.2em] mb-3 text-center">Lihat Strategi Lawan</p>
        <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => setViewingPlayerId(p.id)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl border transition-all flex items-center gap-2 ${viewingPlayerId === p.id ? "bg-pink-600 border-pink-400 scale-105" : "bg-white/5 border-white/5 opacity-60"}`}
            >
              <div className={`w-2 h-2 rounded-full ${p.isReady ? "bg-green-400" : "bg-yellow-400"}`} />
              <span className="text-xs font-bold whitespace-nowrap">
                {p.id === localPlayerId ? "SAYA" : p.name.split(' ')[0]}
              </span>
            </button>
          ))}
        </div>
      </footer>

      {/* Winner Modal */}
      {winnerId && (
        <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-6 text-center animate-in fade-in duration-500">
          <div>
            <p className="text-pink-500 font-black tracking-widest uppercase mb-2">Game Over</p>
            <h1 className="text-6xl font-black text-yellow-400 mb-4">BINGO!</h1>
            <p className="text-xl mb-10 text-white/80"><span className="text-white font-bold">{players.find(p => p.id === winnerId)?.name}</span> memenangkan ronde ini!</p>
            <button onClick={() => window.location.href = '/'} className="w-full py-4 bg-pink-600 rounded-2xl font-black tracking-widest shadow-2xl shadow-pink-900/40">KELUAR</button>
          </div>
        </div>
      )}
    </div>
  );
}