import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket(onState) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io('/', { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', onState);

    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { connected };
}
