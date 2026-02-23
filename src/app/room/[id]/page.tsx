"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useGameStore } from "@/store/useGameStore";
import Timer from "@/components/game/Timer";
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

  // 3. LOGIKA MULAI PERMAINAN (Observer Pattern - Anti Premature Start)
  useEffect(() => {
    // Hanya periksa jika status masih LOBBY/SETUP
    if (status === "LOBBY" || status === "SETUP") {
      const totalPlayers = players.length;
      const readyPlayers = players.filter(p => p.isReady).length;

      // Harus > 1 orang dan SEMUANYA berstatus isReady
      if (totalPlayers > 1 && readyPlayers === totalPlayers) {
        // Tentukan Host (Player pertama join) untuk mengupdate database agar tidak terjadi bentrok request
        const sortedPlayers = [...players].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
        
        if (sortedPlayers[0].id === localPlayerId) {
          supabase.from("rooms")
            .update({ 
              status: "PLAYING", 
              "currentPlayerTurnId": sortedPlayers[0].id 
            })
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
      // Hanya update player info lokal ke siap. 
      // Effect Observer (No. 3) yang akan mendeteksi dan mengubah status room.
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
    <div className="min-h-[100dvh] bg-[#070B14] text-slate-200 flex flex-col font-sans relative overflow-hidden">
      
      {/* Ambient Background Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[30rem] h-[30rem] bg-rose-600/5 rounded-full blur-[150px] pointer-events-none"></div>

      {/* HEADER: Progress B-I-N-G-O & Room Code */}
      <header className="relative z-10 p-4 px-6 flex justify-between items-center bg-[#0B1120]/80 backdrop-blur-2xl border-b border-white/5 shadow-2xl">
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] leading-none mb-1">Arena Code</span>
          <span className="text-xl font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-rose-400">{roomId}</span>
        </div>
        
        <div className="flex gap-1.5">
          {"BINGO".split("").map((letter, i) => (
            <div 
              key={i} 
              className={`w-9 h-9 flex items-center justify-center rounded-xl text-sm font-black border transition-all duration-500
                ${activeLines > i 
                  ? "bg-gradient-to-br from-pink-500 to-rose-600 border-pink-400/50 text-white shadow-[0_0_15px_rgba(236,72,153,0.4)] scale-110" 
                  : "bg-slate-800/50 border-slate-700/50 text-slate-500"}`}
            >
              {letter}
            </div>
          ))}
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="relative z-10 flex-1 flex flex-col items-center p-4 sm:p-6 overflow-y-auto no-scrollbar">
        
        {/* Status Indicator (Giliran atau Menunggu Siap) */}
        <div className="w-full max-w-sm mb-6">
          {status === "PLAYING" && !winnerId && (
            <div className={`text-center py-3 px-4 rounded-2xl border backdrop-blur-md transition-all duration-500 
              ${currentPlayerTurnId === localPlayerId 
                ? "bg-indigo-500/10 border-indigo-500/40 shadow-[0_0_20px_rgba(79,70,229,0.15)]" 
                : "bg-slate-800/40 border-slate-700/50"}`}>
              {currentPlayerTurnId === localPlayerId ? (
                <div className="flex items-center justify-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
                  <p className="text-indigo-400 font-black text-sm uppercase tracking-widest">Giliran Kamu!</p>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 opacity-60">
                  <svg className="w-4 h-4 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  <p className="text-slate-300 text-xs font-bold uppercase tracking-widest">
                    Menunggu {players.find(p => p.id === currentPlayerTurnId)?.name.split(' ')[0]}...
                  </p>
                </div>
              )}
            </div>
          )}

          {(status === "LOBBY" || status === "SETUP") && (
            <div className="flex flex-col items-center gap-4">
              {players.find(p => p.id === localPlayerId)?.isReady && (
                <div className="px-5 py-2.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl backdrop-blur-sm">
                  <p className="text-indigo-400 text-[11px] font-black animate-pulse uppercase tracking-[0.2em]">
                    Menunggu Lawan Siap ({players.filter(p => p.isReady).length}/{players.length})
                  </p>
                </div>
              )}
              {!players.find(p => p.id === localPlayerId)?.isReady && players.length > 0 && (
                <p className="text-slate-400 text-[11px] font-bold uppercase tracking-widest text-center">
                  Atur formasimu dan konfirmasi jika sudah siap.
                </p>
              )}
              <div className="flex justify-center transform scale-90 sm:scale-100">
                <Timer duration={30} onTimeUp={handleReady} />
              </div>
            </div>
          )}
        </div>

        {/* Info Pemilik Board */}
        <div className="mb-4 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-800/50 rounded-full border border-slate-700/50">
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
              {viewingPlayerId === localPlayerId ? "Papan Strategi Kamu" : `Melihat: ${players.find(p => p.id === viewingPlayerId)?.name}`}
            </p>
          </div>
        </div>

        {/* 5x5 BINGO GRID */}
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
                className={`relative aspect-square flex items-center justify-center text-xl sm:text-2xl font-black rounded-2xl border transition-all duration-300 transform active:scale-[0.92]
                  ${isPicked 
                    ? "bg-rose-600 border-rose-500 shadow-[inset_0_2px_10px_rgba(0,0,0,0.3)] text-white" 
                    : isMyBoard && num !== null
                      ? "bg-indigo-600 border-indigo-500 shadow-[0_4px_15px_rgba(79,70,229,0.2)] text-white hover:bg-indigo-500" 
                      : showSecret
                        ? "bg-[#0B1120] border-slate-800 text-slate-700 cursor-not-allowed"
                        : "bg-slate-800/40 border-slate-700/50 text-slate-400 hover:border-slate-600"}`}
              >
                {displayContent}
                {isPicked && !showSecret && (
                  <div className="absolute inset-0 flex items-center justify-center text-4xl opacity-30 select-none mix-blend-overlay">✕</div>
                )}
              </button>
            );
          })}
        </div>

        {/* SETUP ACTIONS */}
        {status !== "PLAYING" && status !== "FINISHED" && (
          <div className="mt-8 flex gap-3 w-full max-w-sm">
            <button 
              onClick={randomizeBoard} 
              className="flex-1 py-4 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-2xl font-bold transition-all active:scale-[0.98]"
            >
              Acak
            </button>
            <button 
              onClick={handleReady} 
              disabled={isUpdating || players.find(p => p.id === localPlayerId)?.isReady}
              className="group relative flex-[2] py-4 rounded-2xl font-black bg-indigo-600 text-white shadow-[0_0_20px_rgba(79,70,229,0.3)] transition-all active:scale-[0.98] disabled:opacity-50 disabled:bg-slate-800 disabled:shadow-none overflow-hidden"
            >
              <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
              <span className="relative z-10">
                {isUpdating ? "Memproses..." : players.find(p => p.id === localPlayerId)?.isReady ? "MENUNGGU..." : "SAYA SIAP"}
              </span>
            </button>
          </div>
        )}
      </main>

      {/* BOTTOM TABS: Pemilih Board (Modern Scrollable Pills) */}
      <footer className="relative z-10 bg-[#0B1120]/90 backdrop-blur-2xl border-t border-slate-800/60 p-4 pb-8 sm:pb-6">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 text-center">Ganti Radar Pemain</p>
        <div className="flex gap-2.5 overflow-x-auto pb-2 no-scrollbar px-2 max-w-2xl mx-auto">
          {players.map((p) => {
            const isActive = viewingPlayerId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setViewingPlayerId(p.id)}
                className={`flex-shrink-0 min-w-[110px] px-4 py-3 rounded-2xl border transition-all duration-300 flex items-center justify-center gap-2.5
                  ${isActive 
                    ? "bg-slate-800 border-indigo-500/50 shadow-[0_0_15px_rgba(79,70,229,0.2)] scale-105" 
                    : "bg-[#070B14] border-slate-800 hover:border-slate-700 opacity-70"}`}
              >
                <div className="relative">
                  <div className={`w-2 h-2 rounded-full ${p.isReady ? "bg-emerald-400" : "bg-amber-400"}`} />
                  {p.isReady && <div className="absolute inset-0 bg-emerald-400 rounded-full animate-ping opacity-50"></div>}
                </div>
                <span className={`text-xs font-bold uppercase truncate max-w-[70px] ${isActive ? "text-indigo-300" : "text-slate-400"}`}>
                  {p.id === localPlayerId ? "SAYA" : p.name.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>
      </footer>

      {/* WINNER OVERLAY (Elegant Display) */}
      {winnerId && (
        <div className="fixed inset-0 z-[100] bg-[#070B14]/90 backdrop-blur-xl flex items-center justify-center p-6 text-center animate-in fade-in duration-700">
          <div className="w-full max-w-sm bg-slate-900/80 p-10 rounded-[2.5rem] border border-slate-800 shadow-[0_0_50px_rgba(225,29,72,0.15)] relative overflow-hidden">
            
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 bg-rose-500/20 rounded-full blur-[50px]"></div>

            <p className="text-indigo-400 font-bold tracking-[0.3em] uppercase text-xs mb-4 relative z-10">Misi Selesai</p>
            <h1 className="text-6xl font-black text-white mb-6 tracking-tighter relative z-10">
              BINGO<span className="text-rose-500">!</span>
            </h1>
            
            <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 px-6 py-3 rounded-full mb-10 relative z-10">
              <span className="text-2xl">👑</span>
              <p className="text-sm font-bold text-slate-200 uppercase tracking-widest">
                <span className="text-indigo-300">{players.find(p => p.id === winnerId)?.name}</span> Menang
              </p>
            </div>
            
            <button 
              onClick={() => window.location.href = '/'} 
              className="w-full py-5 bg-gradient-to-r from-indigo-600 to-rose-600 hover:from-indigo-500 hover:to-rose-500 rounded-2xl font-black tracking-[0.2em] shadow-[0_0_20px_rgba(79,70,229,0.3)] transform active:scale-[0.97] transition-all uppercase text-white relative z-10"
            >
              Tinggalkan Arena
            </button>
          </div>
        </div>
      )}
    </div>
  );
}