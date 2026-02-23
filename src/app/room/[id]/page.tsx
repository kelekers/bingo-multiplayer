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
  
  // State untuk memilih board siapa yang sedang dilihat (Default: Board Saya)
  const [viewingPlayerId, setViewingPlayerId] = useState<string | null>(null);

  useEffect(() => {
    if (localPlayerId && !viewingPlayerId) setViewingPlayerId(localPlayerId);
  }, [localPlayerId, viewingPlayerId]);

  // Data board yang sedang aktif ditampilkan di grid
const activeDisplayBoard = useMemo(() => {
  // Cari data pemain yang sedang diintip di dalam array 'players' (hasil sinkronisasi DB)
  const targetPlayer = players.find(p => p.id === viewingPlayerId);
  
  if (!targetPlayer) return Array(25).fill(null);

  // Jika melihat diri sendiri, gunakan state 'board' utama
  // Jika melihat lawan, gunakan 'targetPlayer.board' dari database
  const targetBoard = viewingPlayerId === localPlayerId ? board : targetPlayer.board;

  // Pastikan data board adalah array (terkadang JSONB terbaca sebagai string jika konfigurasi salah)
  return Array.isArray(targetBoard) ? targetBoard : [];
}, [players, viewingPlayerId, localPlayerId, board]);

  // Kalkulasi B-I-N-G-O untuk board yang sedang dilihat
  const activeLines = useMemo(() => {
    const indices = activeDisplayBoard
      .map((num, idx) => (numbersPicked.includes(num as number) ? idx : -1))
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
      // Ambil semua kolom untuk menghindari Type Error build
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

  // 2. CEK KEMENANGAN OTOMATIS (Hanya jika board sendiri yang tembus)
  const myLines = useMemo(() => {
    const indices = board
      .map((num, idx) => (numbersPicked.includes(num as number) ? idx : -1))
      .filter(idx => idx !== -1);
    return checkBingoLines(indices);
  }, [board, numbersPicked]);

  // Safety Guard: Mengisi board otomatis jika game mulai mendadak
  useEffect(() => {
    const checkEmptyBoard = async () => {
        // Jika status sudah PLAYING tapi board lokal masih kosong
        const isBoardEmpty = board.filter(n => n !== null).length === 0;
        
        if (status === "PLAYING" && isBoardEmpty && localPlayerId) {
        const autoBoard = Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
        
        // Update lokal
        useGameStore.setState({ board: autoBoard });
        
        // Update database agar pemain lain bisa melihat board kita (Fitur Intip)
        await supabase.from("players")
            .update({ isReady: true, board: autoBoard })
            .eq("id", localPlayerId);
        
        console.log("Board diisi otomatis karena game sudah dimulai.");
        }
    };

    checkEmptyBoard();
  }, [status, localPlayerId, board]);

  useEffect(() => {
    if (myLines >= 5 && status === "PLAYING" && !winnerId) {
      supabase.from("rooms")
        .update({ winnerId: localPlayerId, status: "FINISHED" })
        .eq("id", roomId)
        .then();
    }
  }, [myLines, status, winnerId, localPlayerId, roomId]);

  // 3. HANDLERS
const handleReady = async () => {
  if (!localPlayerId || isUpdating) return;
  setIsUpdating(true);

  // 1. Siapkan board (jika belum penuh, acak otomatis)
  const isFull = board.filter(n => n !== null).length === 25;
  const finalBoard = isFull ? board : Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

  // Update state lokal agar tampilan langsung berubah
  useGameStore.setState({ board: finalBoard });

  try {
    // 2. Update status isReady saya ke Database (Gunakan tanda kutip jika kolom di SQL pakai CamelCase)
    const { error: updateError } = await supabase.from("players")
      .update({ 
        "isReady": true, 
        board: finalBoard 
      })
      .eq("id", localPlayerId);

    if (updateError) throw updateError;

    // 3. AMBIL DATA TERBARU SEMUA PEMAIN DARI DATABASE (PENTING!)
    // Kita tidak boleh pakai data dari Store karena mungkin belum sinkron
    const { data: allPlayers, error: fetchError } = await supabase
      .from("players")
      .select('id, "isReady"')
      .eq("room_id", roomId);

    if (fetchError) throw fetchError;

    // 4. LOGIKA VALIDASI MULAI GAME
    const totalInRoom = allPlayers?.length || 0;
    const readyCount = allPlayers?.filter(p => p.isReady).length || 0;

    // Game HANYA MULAI jika:
    // - Pemain minimal 2 orang (mencegah main sendirian)
    // - Semua orang yang ada di tabel 'players' untuk room ini statusnya isReady = true
    if (totalInRoom > 1 && readyCount === totalInRoom) {
      
      // Tentukan siapa yang giliran pertama (berdasarkan siapa yang join paling awal)
      const { data: firstJoiner } = await supabase.from("players")
        .select("id")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      // Update Room menjadi PLAYING
      await supabase.from("rooms")
        .update({ 
          status: "PLAYING",
          "currentPlayerTurnId": firstJoiner?.id 
        })
        .eq("id", roomId);

    } else {
      // Jika belum memenuhi syarat, cukup beri notifikasi log atau alert (opsional)
      console.log(`Menunggu pemain lain: ${readyCount}/${totalInRoom} siap.`);
    }
  } catch (err) {
    console.error("Gagal sinkronisasi siap:", err);
    alert("Koneksi bermasalah, coba klik Siap lagi.");
  } finally {
    setIsUpdating(false);
  }
};

  const handleCellClick = async (num: number, index: number) => {
    if (status === "SETUP" || status === "LOBBY") {
      fillCell(index);
    } else if (status === "PLAYING") {
      // Tombol hanya berfungsi jika: 1. Giliran saya, 2. Melihat board saya sendiri
      if (currentPlayerTurnId !== localPlayerId || viewingPlayerId !== localPlayerId) return;
      if (numbersPicked.includes(num)) return;

      const sortedPlayers = [...players].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const myIdx = sortedPlayers.findIndex(p => p.id === localPlayerId);
      const nextId = sortedPlayers[(myIdx + 1) % sortedPlayers.length].id;

      await supabase.from("rooms").update({ numbersPicked: [...numbersPicked, num], currentPlayerTurnId: nextId }).eq("id", roomId);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#020617] text-white flex flex-col font-sans overflow-hidden">
      
      {/* HEADER: Progress B-I-N-G-O & Room Code */}
      <header className="p-4 flex justify-between items-center bg-slate-900/80 backdrop-blur-md border-b border-white/5 shadow-xl">
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-pink-500 uppercase tracking-widest">Arena</span>
          <span className="text-xl font-mono font-black">{roomId}</span>
        </div>
        
        <div className="flex gap-1.5">
          {"BINGO".split("").map((letter, i) => (
            <div 
              key={i} 
              className={`w-9 h-9 flex items-center justify-center rounded-xl text-sm font-black border transition-all duration-500
                ${activeLines > i 
                  ? "bg-pink-600 border-pink-400 shadow-[0_0_15px_rgba(236,72,153,0.5)] scale-105" 
                  : "bg-white/5 border-white/5 opacity-20"}`}
            >
              {letter}
            </div>
          ))}
        </div>
      </header>

      {/* MAIN CONTENT: Status & Board */}
      <main className="flex-1 flex flex-col items-center p-4 overflow-y-auto no-scrollbar">
        
        {/* Status Indicator (Giliran atau Menunggu Siap) */}
        <div className="w-full max-w-sm mb-4">
        {/* 1. Jika SEDANG MAIN: Tampilkan Giliran */}
        {status === "PLAYING" && !winnerId && (
            <div className={`text-center py-2.5 px-4 rounded-2xl border transition-all duration-300 ${currentPlayerTurnId === localPlayerId ? "bg-green-500/10 border-green-500/30 shadow-[0_0_20px_rgba(34,197,94,0.1)]" : "bg-white/5 border-white/5"}`}>
            {currentPlayerTurnId === localPlayerId ? (
                <p className="text-green-400 font-black text-sm animate-pulse tracking-tight">🚀 GILIRAN KAMU! KLIK SATU ANGKA</p>
            ) : (
                <p className="text-white/30 text-xs font-bold uppercase tracking-widest">
                Menunggu {players.find(p => p.id === currentPlayerTurnId)?.name}...
                </p>
            )}
            </div>
        )}

        {/* 2. Jika BELUM MAIN: Tampilkan Status Menunggu & Timer */}
        {(status === "LOBBY" || status === "SETUP") && (
            <div className="flex flex-col items-center gap-3">
            {/* Tampilkan teks ini hanya jika pemain lokal sudah klik SAYA SIAP */}
            {players.find(p => p.id === localPlayerId)?.isReady && (
                <p className="text-[10px] font-black text-pink-500 uppercase tracking-[0.2em] animate-pulse">
                Menunggu Pemain Lain... ({players.filter(p => p.isReady).length}/{players.length})
                </p>
            )}
            
            {/* Timer tetap muncul di sini */}
            <div className="flex justify-center">
                <Timer duration={30} onTimeUp={handleReady} />
            </div>
            </div>
        )}
        </div>

        {/* Info Pemilik Board */}
        <div className="mb-2 text-center">
          <p className="text-[10px] font-bold text-white/30 uppercase tracking-[0.3em]">
            {viewingPlayerId === localPlayerId ? "Papan Kamu" : `Mengintip Papan: ${players.find(p => p.id === viewingPlayerId)?.name}`}
          </p>
        </div>

        {/* Letakkan di dalam return, sebelum bagian grid board */}
        {status !== "PLAYING" && players.length > 0 && (
        <div className="mb-4 text-center">
            {players.find(p => p.id === localPlayerId)?.isReady ? (
            <div className="px-4 py-2 bg-pink-500/20 border border-pink-500/30 rounded-xl">
                <p className="text-pink-400 text-xs font-black animate-pulse uppercase tracking-widest">
                Menunggu Lawan Siap... ({players.filter(p => p.isReady).length} / {players.length})
                </p>
            </div>
            ) : (
            <p className="text-white/30 text-[10px] font-bold uppercase tracking-widest">
                Susun board kamu lalu klik siap!
            </p>
            )}
        </div>
        )}

        {/* 5x5 BINGO GRID */}
        <div className="w-full max-w-[min(90vw,420px)] aspect-square grid grid-cols-5 gap-2 sm:gap-3">
          {activeDisplayBoard.map((num, index) => {
            const isPicked = numbersPicked.includes(num as number);
            const isMyBoard = viewingPlayerId === localPlayerId;
            
            return (
              <button 
                key={index} 
                onClick={() => handleCellClick(num as number, index)}
                disabled={!isMyBoard || status === "FINISHED"}
                className={`relative aspect-square flex items-center justify-center text-xl sm:text-2xl font-black rounded-2xl border transition-all duration-200 transform active:scale-95
                  ${isPicked 
                    ? "bg-pink-600 border-pink-400 shadow-inner" 
                    : isMyBoard 
                      ? "bg-indigo-600 border-indigo-400 text-white shadow-lg" 
                      : "bg-slate-800/50 border-slate-700 text-slate-500"}`}
              >
                {num}
                {isPicked && <div className="absolute inset-0 bg-black/20 flex items-center justify-center text-4xl opacity-30 select-none">✕</div>}
              </button>
            );
          })}
        </div>

        {/* SETUP ACTIONS */}
        {status !== "PLAYING" && status !== "FINISHED" && (
          <div className="mt-8 flex gap-3 w-full max-w-sm">
            <button onClick={randomizeBoard} className="flex-1 py-4 bg-white/5 border border-white/10 rounded-2xl font-bold active:bg-white/10">Acak</button>
            <button onClick={handleReady} disabled={isUpdating} className="flex-[2] py-4 rounded-2xl font-black bg-gradient-to-r from-pink-600 to-rose-500 shadow-xl shadow-pink-900/30">
              {isUpdating ? "LOADING..." : "SAYA SIAP"}
            </button>
          </div>
        )}
      </main>

      {/* BOTTOM TABS: Pemilih Board (Android UI Style) */}
      <footer className="bg-slate-900/90 backdrop-blur-xl border-t border-white/5 p-4 pb-8">
        <p className="text-[10px] font-black text-white/20 uppercase tracking-[0.2em] mb-4 text-center">Ganti Tampilan Board</p>
        <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar px-2">
          {players.map((p) => (
            <button
              key={p.id}
              onClick={() => setViewingPlayerId(p.id)}
              className={`flex-shrink-0 min-w-[100px] px-4 py-2.5 rounded-2xl border transition-all duration-300 flex items-center justify-center gap-2
                ${viewingPlayerId === p.id 
                  ? "bg-pink-600 border-pink-400 scale-105 shadow-lg shadow-pink-900/20" 
                  : "bg-white/5 border-white/5 opacity-50"}`}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${p.isReady ? "bg-green-400" : "bg-yellow-400"}`} />
              <span className="text-[11px] font-black uppercase truncate max-w-[80px]">
                {p.id === localPlayerId ? "SAYA" : p.name.split(' ')[0]}
              </span>
            </button>
          ))}
        </div>
      </footer>

      {/* WINNER OVERLAY */}
      {winnerId && (
        <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-2xl flex items-center justify-center p-8 text-center animate-in fade-in duration-500">
          <div className="max-w-xs">
            <p className="text-pink-500 font-black tracking-widest uppercase text-xs mb-2">Round Finished</p>
            <h1 className="text-7xl font-black text-yellow-400 mb-4 drop-shadow-[0_0_20px_rgba(250,204,21,0.3)]">BINGO!</h1>
            <p className="text-xl font-bold text-white mb-10">
              👑 <span className="text-yellow-400 underline">{players.find(p => p.id === winnerId)?.name}</span> Menang!
            </p>
            <button 
              onClick={() => window.location.href = '/'} 
              className="w-full py-5 bg-gradient-to-r from-pink-600 to-rose-500 rounded-2xl font-black tracking-[0.2em] shadow-2xl shadow-pink-900/40 transform active:scale-95 transition-all"
            >
              MAIN LAGI
            </button>
          </div>
        </div>
      )}
    </div>
  );
}