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
    setNumbersPicked, winnerId, setWinner,
  } = useGameStore();

  const [isUpdating, setIsUpdating] = useState(false);

  // Menghitung jumlah baris Bingo (B-I-N-G-O)
  const linesCount = useMemo(() => {
    const checkedIndices = board
      .map((num, idx) => (numbersPicked.includes(num as number) ? idx : -1))
      .filter((idx) => idx !== -1);
    return checkBingoLines(checkedIndices);
  }, [board, numbersPicked]);

  // 1. SINKRONISASI REAL-TIME & AUTO-REGISTRATION
  useEffect(() => {
    // Jika user masuk tanpa nama/ID (misal lewat link langsung), lempar ke Lobby
    if (!localPlayerId) {
      router.push("/");
      return;
    }

    const initSync = async () => {
      // A. Daftarkan diri ke DB jika belum terdaftar di room ini
      // Menggunakan upsert agar tidak membuat baris baru jika ID sudah ada
      await supabase.from("players").upsert({
        id: localPlayerId,
        room_id: roomId,
        name: playerName,
      });

      // B. Ambil data pemain & room secara berkala/awal
      fetchRoomData();
    };

    const fetchRoomData = async () => {
      const { data: pData } = await supabase.from("players").select("*").eq("room_id", roomId);
      if (pData) updatePlayers(pData);

      const { data: rData } = await supabase.from("rooms").select("*").eq("id", roomId).single();
      if (rData) {
        setNumbersPicked(rData.numbersPicked || []);
        if (rData.status !== status) setGameStatus(rData.status);
        if (rData.winner_id) setWinner(rData.winner_id);
      }
    };

    // C. Subscribe ke perubahan Real-time
    const playerChannel = supabase
      .channel(`players-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, 
        () => fetchRoomData())
      .subscribe();

    const roomChannel = supabase
      .channel(`room-${roomId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, 
        (payload) => {
        setNumbersPicked(payload.new.numbersPicked || []);
        setGameStatus(payload.new.status);
        setWinner(payload.new.winner_id);
        // UPDATE INI: Masukkan current_turn_id ke store
        useGameStore.setState({ currentPlayerTurnId: payload.new.current_turn_id });
        })
      .subscribe();

    initSync();

    return () => {
      supabase.removeChannel(playerChannel);
      supabase.removeChannel(roomChannel);
    };
  }, [roomId, localPlayerId, playerName, router]);

  // 2. CEK KEMENANGAN (Otomatis saat mencapai 5 baris)
  useEffect(() => {
    if (linesCount >= 5 && status === "PLAYING" && !winnerId) {
      supabase.from("rooms")
        .update({ winner_id: localPlayerId, status: "FINISHED" })
        .eq("id", roomId)
        .then();
    }
  }, [linesCount, status, winnerId, localPlayerId, roomId]);

  // 3. HANDLER SAYA SIAP
const handleReady = async () => {
  if (!localPlayerId || isUpdating) return;
  setIsUpdating(true);
  
  const isFull = board.filter(n => n !== null).length === 25;
  const finalBoard = isFull ? board : Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);

  try {
    // 1. Update status ready diri sendiri
    await supabase.from("players").update({ is_ready: true, board: finalBoard }).eq("id", localPlayerId);

    // 2. Ambil semua player untuk cek apakah semua sudah ready
    const { data: allP } = await supabase.from("players")
      .select("id, created_at, is_ready")
      .eq("room_id", roomId)
      .order('created_at', { ascending: true }); // Urutkan berdasarkan waktu join

    if (allP && allP.length > 0 && allP.every(p => p.is_ready)) {
      // 3. Jika semua ready, tentukan player pertama (indeks 0 adalah yang paling pertama join)
      await supabase.from("rooms").update({ 
        status: "PLAYING",
        current_turn_id: allP[0].id 
      }).eq("id", roomId);
    }
  } catch (err) {
    console.error(err);
  } finally {
    setIsUpdating(false);
  }
};

  // 4. HANDLER KLIK ANGKA
const handleCellClick = async (num: number, index: number) => {
  // Ambil data room terbaru untuk cek giliran
  const { data: roomNow } = await supabase.from("rooms").select("current_turn_id").eq("id", roomId).single();
  
  if (status === "SETUP" || status === "LOBBY") {
    fillCell(index);
  } 
  else if (status === "PLAYING") {
    // CEK: Apakah ini giliran saya?
    if (roomNow?.current_turn_id !== localPlayerId) {
      alert("Sabar! Sekarang giliran " + players.find(p => p.id === roomNow?.current_turn_id)?.name);
      return;
    }

    if (numbersPicked.includes(num)) return;

    // 1. Update angka yang dipilih
    const newPicked = [...numbersPicked, num];
    
    // 2. Cari siapa pemain berikutnya
    // Urutkan player berdasarkan waktu join
    const sortedPlayers = [...players].sort((a, b) => 
      new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
    
    const currentIndex = sortedPlayers.findIndex(p => p.id === localPlayerId);
    const nextIndex = (currentIndex + 1) % sortedPlayers.length;
    const nextPlayerId = sortedPlayers[nextIndex].id;

    // 3. Update angka dan pindahkan giliran di database
    await supabase.from("rooms").update({ 
      numbersPicked: newPicked,
      current_turn_id: nextPlayerId
    }).eq("id", roomId);
  }
};

  return (
    <div className="min-h-screen bg-[#0f172a] text-white p-4 font-sans selection:bg-pink-500/30">
      
      {/* Sidebar - Daftar Pemain */}
      <div className="fixed top-4 left-4 z-10 hidden lg:block w-52 space-y-2">
        <p className="text-[10px] font-black opacity-30 uppercase tracking-[0.2em] px-2">Live Players</p>
        <div className="space-y-1">
          {players.map((p) => (
            <div key={p.id} className="bg-white/5 border border-white/10 p-3 rounded-2xl flex items-center gap-3 backdrop-blur-md">
              <div className={`w-2 h-2 rounded-full ${p.isReady ? "bg-green-500 shadow-[0_0_10px_#22c55e]" : "bg-yellow-500 animate-pulse"}`} />
              <span className={`text-sm truncate ${p.id === localPlayerId ? "text-pink-400 font-bold" : "text-white/70"}`}>
                {p.name} {p.id === localPlayerId && "(You)"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-md mx-auto pt-6 flex flex-col items-center">
        
        {/* B-I-N-G-O Progress Bar */}
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

        {/* Indikator Giliran */}
        {status === "PLAYING" && !winnerId && (
        <div className="mb-4 w-full bg-indigo-500/10 border border-indigo-500/20 py-2 px-4 rounded-xl text-center">
            {players.find(p => p.id === useGameStore.getState().currentPlayerTurnId)?.id === localPlayerId ? (
            <p className="text-green-400 font-bold animate-bounce">✨ Giliran Kamu! Klik satu angka.</p>
            ) : (
            <p className="text-white/50 text-sm">
                Menunggu <span className="text-white font-bold">{players.find(p => p.id === useGameStore.getState().currentPlayerTurnId)?.name}</span> memilih angka...
            </p>
            )}
        </div>
        )}

        {/* Room Information */}
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

        {/* Bingo Grid 5x5 */}
        <div className="grid grid-cols-5 gap-3 w-full aspect-square">
          {board.map((num, index) => {
            const isPicked = numbersPicked.includes(num as number);
            return (
              <button 
                key={index} 
                onClick={() => handleCellClick(num as number, index)} 
                disabled={status === "FINISHED"}
                className={`relative aspect-square flex items-center justify-center text-xl font-black rounded-2xl border transition-all duration-300 transform active:scale-90
                  ${isPicked 
                    ? "bg-pink-600 border-pink-400 shadow-inner" 
                    : num 
                      ? "bg-indigo-600 border-indigo-400 text-white" 
                      : "bg-white/5 border-white/10 text-white/10 hover:border-white/20"}`}
              >
                {num}
                {isPicked && (
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center text-4xl opacity-40 select-none">✕</div>
                )}
              </button>
            );
          })}
        </div>

        {/* Action Controls */}
        {status !== "PLAYING" && status !== "FINISHED" && (
          <div className="mt-10 flex gap-4 w-full">
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
              {isUpdating ? "LOADING..." : "SAYA SIAP"}
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