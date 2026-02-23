"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useGameStore } from "@/store/useGameStore";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { checkBingoLines } from "@/lib/bingo-logic";
import { Player } from "@/types";

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
  const [viewingPlayerId, setViewingPlayerId] = useState<string | null>(null);

  useEffect(() => {
    if (localPlayerId && !viewingPlayerId) setViewingPlayerId(localPlayerId);
  }, [localPlayerId, viewingPlayerId]);

  // Data board yang sedang aktif ditampilkan
  const activeDisplayBoard = useMemo(() => {
    const targetPlayer = players.find(p => p.id === viewingPlayerId);
    if (!targetPlayer) return Array(25).fill(null);
    const targetBoard = viewingPlayerId === localPlayerId ? board : targetPlayer.board;
    return Array.isArray(targetBoard) && targetBoard.length === 25 ? targetBoard : Array(25).fill(null);
  }, [players, viewingPlayerId, localPlayerId, board]);

  // Kalkulasi B-I-N-G-O (Hanya angka valid yang diperiksa)
  const activeLines = useMemo(() => {
    const indices = activeDisplayBoard
      .map((num, idx) => (num !== null && numbersPicked.includes(num as number) ? idx : -1))
      .filter(idx => idx !== -1);
    return checkBingoLines(indices);
  }, [activeDisplayBoard, numbersPicked]);

  // 1. SINKRONISASI DATA & REALTIME
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
      
      if (pData) updatePlayers(pData as Player[]);

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
      await supabase.from("players").upsert({
        id: localPlayerId,
        room_id: roomId,
        name: playerName,
      });
      await fetchRoomData();
    };

    const channel = supabase
      .channel(`room-${roomId}`)
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
  }, [roomId, localPlayerId, router]);

  // 2. SAFETY GUARD: Mengisi board otomatis jika game mulai mendadak
  useEffect(() => {
    const checkEmptyBoard = async () => {
      const isBoardEmpty = board.filter(n => n !== null).length === 0;
      if (status === "PLAYING" && isBoardEmpty && localPlayerId) {
        const autoBoard = Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
        useGameStore.setState({ board: autoBoard });
        await supabase.from("players").update({ "isReady": true, board: autoBoard }).eq("id", localPlayerId);
      }
    };
    checkEmptyBoard();
  }, [status, localPlayerId, board]);

  // 3. LOGIKA MULAI PERMAINAN (Observer Pattern)
  useEffect(() => {
    if (status === "LOBBY" || status === "SETUP") {
      const totalPlayers = players.length;
      const readyPlayers = players.filter(p => p.isReady).length;

      if (totalPlayers > 1 && readyPlayers === totalPlayers) {
        const sortedPlayers = [...players].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
        if (sortedPlayers[0].id === localPlayerId) {
          supabase.from("rooms")
            .update({ status: "PLAYING", "currentPlayerTurnId": sortedPlayers[0].id })
            .eq("id", roomId)
            .then();
        }
      }
    }
  }, [players, status, localPlayerId, roomId]);

  // 4. CEK KEMENANGAN OTOMATIS
  const myLines = useMemo(() => {
    const indices = board.map((num, idx) => (numbersPicked.includes(num as number) ? idx : -1)).filter(idx => idx !== -1);
    return checkBingoLines(indices);
  }, [board, numbersPicked]);

  useEffect(() => {
    if (myLines >= 5 && status === "PLAYING" && !winnerId) {
      supabase.from("rooms").update({ "winnerId": localPlayerId, status: "FINISHED" }).eq("id", roomId).then();
    }
  }, [myLines, status, winnerId, localPlayerId, roomId]);

  // 5. HANDLERS
  const handleReady = async () => {
    if (!localPlayerId || isUpdating) return;
    setIsUpdating(true);

    const isFull = board.filter(n => n !== null).length === 25;
    const finalBoard = isFull ? board : Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

    useGameStore.setState({ board: finalBoard });

    try {
      await supabase.from("players")
        .update({ "isReady": true, board: finalBoard })
        .eq("id", localPlayerId);
    } catch (err) {
      console.error("Gagal sinkronisasi siap:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCellClick = async (num: number, index: number) => {
    if (status === "SETUP" || status === "LOBBY") {
      fillCell(index);
    } else if (status === "PLAYING") {
      if (currentPlayerTurnId !== localPlayerId || viewingPlayerId !== localPlayerId) return;
      if (numbersPicked.includes(num)) return;

      const sortedPlayers = [...players].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
      const myIdx = sortedPlayers.findIndex(p => p.id === localPlayerId);
      const nextId = sortedPlayers[(myIdx + 1) % sortedPlayers.length].id;

      await supabase.from("rooms").update({ "numbersPicked": [...numbersPicked, num], "currentPlayerTurnId": nextId }).eq("id", roomId);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900 flex flex-col font-sans relative overflow-hidden selection:bg-blue-100 selection:text-blue-900">
      
      {/* HEADER: Progress B-I-N-G-O & Room Code - Clean White */}
      <header className="relative z-10 p-4 px-6 flex justify-between items-center bg-white/80 backdrop-blur-xl border-b border-slate-200 shadow-sm">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] leading-none mb-1">Arena Code</span>
          <span className="text-xl font-mono font-black text-blue-600">{roomId}</span>
        </div>
        
        <div className="flex gap-1 sm:gap-1.5">
          {"BINGO".split("").map((letter, i) => (
            <div 
              key={i} 
              className={`w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-xl text-sm font-black border transition-all duration-500
                ${activeLines > i 
                  ? "bg-blue-600 border-blue-600 text-white shadow-[0_4px_10px_rgba(37,99,235,0.3)] scale-105" 
                  : "bg-slate-100 border-slate-200 text-slate-400"}`}
            >
              {letter}
            </div>
          ))}
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 sm:p-6 overflow-y-auto no-scrollbar">
        
        {/* Status Indicator (Clean Pill Style) */}
        <div className="w-full max-w-sm mb-6">
          {status === "PLAYING" && !winnerId && (
            <div className={`text-center py-3 px-4 rounded-xl border transition-all duration-500 
              ${currentPlayerTurnId === localPlayerId 
                ? "bg-emerald-50 border-emerald-200 shadow-sm" 
                : "bg-white border-slate-200 shadow-sm"}`}>
              {currentPlayerTurnId === localPlayerId ? (
                <div className="flex items-center justify-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <p className="text-emerald-700 font-bold text-sm uppercase tracking-widest">Giliran Kamu!</p>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest">
                    Menunggu {players.find(p => p.id === currentPlayerTurnId)?.name.split(' ')[0]}...
                  </p>
                </div>
              )}
            </div>
          )}

          {(status === "LOBBY" || status === "SETUP") && (
            <div className="flex flex-col items-center gap-4">
              {players.find(p => p.id === localPlayerId)?.isReady ? (
                <div className="px-5 py-2.5 bg-blue-50 border border-blue-100 rounded-full shadow-sm">
                  <p className="text-blue-700 text-xs font-bold animate-pulse uppercase tracking-wider">
                    Menunggu Lawan Siap ({players.filter(p => p.isReady).length}/{Math.max(2, players.length)})
                  </p>
                </div>
              ) : (
                <p className="text-slate-500 text-xs font-semibold uppercase tracking-wider text-center">
                  Atur formasimu dan klik siap.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Info Pemilik Board */}
        <div className="mb-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white rounded-full border border-slate-200 shadow-sm">
            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            <p className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest">
              {viewingPlayerId === localPlayerId ? "Papan Strategi Kamu" : `Melihat: ${players.find(p => p.id === viewingPlayerId)?.name}`}
            </p>
          </div>
        </div>

        {/* 5x5 BINGO GRID - Minimalist Design */}
        <div className="w-full max-w-[min(90vw,420px)] aspect-square grid grid-cols-5 gap-2 sm:gap-3">
          {activeDisplayBoard.map((num, index) => {
            const isPicked = num !== null && numbersPicked.includes(num as number);
            const isMyBoard = viewingPlayerId === localPlayerId;
            const targetPlayerReady = players.find(p => p.id === viewingPlayerId)?.isReady;
            
            // CEGAH EXPLOIT: Jika lihat board lawan tapi lawan belum isReady, sembunyikan!
            const showSecret = !isMyBoard && !targetPlayerReady;
            const displayContent = showSecret ? "?" : num;

            return (
              <button 
                key={index} 
                onClick={() => handleCellClick(num as number, index)}
                disabled={!isMyBoard || status === "FINISHED" || showSecret || (status === "PLAYING" && currentPlayerTurnId !== localPlayerId)}
                className={`relative aspect-square flex items-center justify-center text-xl sm:text-2xl font-black rounded-xl sm:rounded-2xl border transition-all duration-200 transform active:scale-[0.95]
                  ${isPicked 
                    ? "bg-blue-600 border-blue-700 shadow-inner text-white" 
                    : isMyBoard && num !== null
                      ? "bg-white border-slate-200 text-slate-800 shadow-sm hover:border-blue-300 hover:bg-slate-50" 
                      : showSecret
                        ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed"
                        : "bg-slate-50 border-slate-200 text-slate-500"}`}
              >
                {displayContent}
                {isPicked && !showSecret && (
                  <div className="absolute inset-0 flex items-center justify-center text-4xl opacity-40 select-none">✕</div>
                )}
              </button>
            );
          })}
        </div>

        {/* SETUP ACTIONS - Minimalist Buttons */}
        {status !== "PLAYING" && status !== "FINISHED" && (
          <div className="mt-8 flex gap-3 w-full max-w-sm">
            <button 
              onClick={randomizeBoard} 
              className="flex-1 py-4 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl font-bold shadow-sm transition-all active:scale-[0.98]"
            >
              Acak
            </button>
            <button 
              onClick={handleReady} 
              disabled={isUpdating || players.find(p => p.id === localPlayerId)?.isReady}
              className="flex-[2] py-4 rounded-xl font-bold bg-slate-900 text-white shadow-md hover:bg-slate-800 transition-all active:scale-[0.98] disabled:opacity-40 disabled:bg-slate-500 disabled:shadow-none"
            >
              {isUpdating ? "Memproses..." : players.find(p => p.id === localPlayerId)?.isReady ? "MENUNGGU..." : "SAYA SIAP"}
            </button>
          </div>
        )}
      </main>

      {/* BOTTOM TABS: Pemilih Board (Clean Pills) */}
      <footer className="relative z-10 bg-white/90 backdrop-blur-xl border-t border-slate-200 p-4 pb-8 sm:pb-6 shadow-[0_-10px_40px_rgba(0,0,0,0.03)]">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 text-center">Ganti Radar Pemain</p>
        <div className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar px-2 max-w-2xl mx-auto">
          {players.map((p) => {
            const isActive = viewingPlayerId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setViewingPlayerId(p.id)}
                className={`flex-shrink-0 min-w-[110px] px-4 py-2.5 rounded-xl border transition-all duration-300 flex items-center justify-center gap-2.5
                  ${isActive 
                    ? "bg-white border-blue-500 shadow-sm scale-105" 
                    : "bg-slate-50 border-slate-200 hover:bg-slate-100"}`}
              >
                <div className="relative">
                  <div className={`w-2 h-2 rounded-full ${p.isReady ? "bg-emerald-500" : "bg-amber-400"}`} />
                </div>
                <span className={`text-xs font-bold uppercase truncate max-w-[70px] ${isActive ? "text-blue-700" : "text-slate-600"}`}>
                  {p.id === localPlayerId ? "SAYA" : p.name.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>
      </footer>

      {/* WINNER OVERLAY (Clean & Professional Display) */}
      {winnerId && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6 text-center animate-in fade-in duration-500">
          <div className="w-full max-w-sm bg-white p-10 rounded-[2rem] border border-slate-100 shadow-2xl relative overflow-hidden">
            
            <p className="text-slate-400 font-bold tracking-[0.2em] uppercase text-xs mb-2">Permainan Selesai</p>
            <h1 className="text-5xl font-black text-slate-900 mb-6 tracking-tight">
              BINGO<span className="text-blue-600">!</span>
            </h1>
            
            <div className="inline-flex items-center gap-2 bg-slate-50 border border-slate-200 px-6 py-3 rounded-xl mb-10">
              <span className="text-xl">🏆</span>
              <p className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                <span className="text-blue-600">{players.find(p => p.id === winnerId)?.name}</span> Menang
              </p>
            </div>
            
            <button 
              onClick={() => window.location.href = '/'} 
              className="w-full py-4 bg-slate-900 hover:bg-slate-800 rounded-xl font-bold text-white shadow-md active:scale-[0.98] transition-all uppercase tracking-widest text-sm"
            >
              Keluar Arena
            </button>
          </div>
        </div>
      )}
    </div>
  );
}