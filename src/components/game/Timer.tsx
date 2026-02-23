"use client";
import { useState, useEffect } from "react";

export default function Timer({ duration, onTimeUp }: { duration: number, onTimeUp: () => void }) {
  const [timeLeft, setTimeLeft] = useState(duration);

  useEffect(() => {
    if (timeLeft <= 0) {
      onTimeUp();
      return;
    }
    const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft, onTimeUp]);

  return (
    <div className="text-2xl font-mono font-bold text-pink-400 bg-white/5 px-6 py-2 rounded-full border border-white/10">
      00:{timeLeft < 10 ? `0${timeLeft}` : timeLeft}
    </div>
  );
}