package com.guanyun.weather;

import java.io.IOException;
import java.util.ArrayDeque;

/** Shared bounded network slots; map traffic is prioritized over offline bulk work. */
final class MapTransferBudget {
    enum Kind { MAP, OFFLINE }
    private final int totalLimit, mapLimit, offlineLimit, offlineDuringMap;
    private final ArrayDeque<Ticket> mapQueue=new ArrayDeque<>(), offlineQueue=new ArrayDeque<>();
    private int activeMap, activeOffline;

    MapTransferBudget(int totalLimit,int mapLimit,int offlineLimit,int offlineDuringMap){
        if(totalLimit<1||mapLimit<1||offlineLimit<1||offlineDuringMap<1||mapLimit+offlineLimit>totalLimit||offlineDuringMap>offlineLimit)throw new IllegalArgumentException("invalid transfer limits");
        this.totalLimit=totalLimit;this.mapLimit=mapLimit;this.offlineLimit=offlineLimit;this.offlineDuringMap=offlineDuringMap;
    }
    synchronized Ticket ticket(Kind kind){return new Ticket(this,kind);}
    Lease acquire(Ticket ticket)throws IOException{
        synchronized(this){
            if(ticket.owner!=this)throw new IOException("Invalid network ticket");
            if(ticket.queued||ticket.acquired)throw new IOException("Network ticket already in use");
            if(ticket.cancelled)throw cancelled();
            ticket.queued=true;(ticket.kind==Kind.MAP?mapQueue:offlineQueue).addLast(ticket);notifyAll();
            try{
                for(;;){
                    if(ticket.cancelled)throw cancelled();
                    if(canAcquire(ticket)){ArrayDeque<Ticket> queue=ticket.kind==Kind.MAP?mapQueue:offlineQueue;queue.remove(ticket);ticket.queued=false;ticket.acquired=true;if(ticket.kind==Kind.MAP)activeMap++;else activeOffline++;notifyAll();return new Lease(this,ticket);}
                    wait();
                }
            }catch(InterruptedException interrupted){if(ticket.queued)(ticket.kind==Kind.MAP?mapQueue:offlineQueue).remove(ticket);ticket.queued=false;notifyAll();Thread.currentThread().interrupt();throw cancelled();}
            catch(IOException cancelled){if(ticket.queued)(ticket.kind==Kind.MAP?mapQueue:offlineQueue).remove(ticket);ticket.queued=false;notifyAll();throw cancelled;}
        }
    }
    private boolean canAcquire(Ticket ticket){
        int total=activeMap+activeOffline;
        if(total>=totalLimit)return false;
        if(ticket.kind==Kind.MAP)return mapQueue.peekFirst()==ticket&&activeMap<mapLimit;
        int limit=(activeMap>0||!mapQueue.isEmpty())?offlineDuringMap:offlineLimit;
        return mapQueue.isEmpty()&&offlineQueue.peekFirst()==ticket&&activeOffline<limit;
    }
    private synchronized void cancel(Ticket ticket){ticket.cancelled=true;if(ticket.queued)(ticket.kind==Kind.MAP?mapQueue:offlineQueue).remove(ticket);ticket.queued=false;notifyAll();}
    private synchronized void release(Ticket ticket){if(!ticket.acquired)return;ticket.acquired=false;if(ticket.kind==Kind.MAP)activeMap--;else activeOffline--;notifyAll();}
    synchronized int activeMap(){return activeMap;}
    synchronized int activeOffline(){return activeOffline;}
    synchronized int waitingMap(){return mapQueue.size();}
    synchronized int waitingOffline(){return offlineQueue.size();}
    private static IOException cancelled(){return new IOException("Tile request cancelled");}

    static final class Ticket {
        private final MapTransferBudget owner;final Kind kind;private boolean queued,acquired,cancelled;
        private Ticket(MapTransferBudget owner,Kind kind){this.owner=owner;this.kind=kind;}
        void cancel(){owner.cancel(this);}
    }
    static final class Lease implements AutoCloseable {
        private final MapTransferBudget owner;private final Ticket ticket;private boolean closed;
        private Lease(MapTransferBudget owner,Ticket ticket){this.owner=owner;this.ticket=ticket;}
        @Override public void close(){synchronized(this){if(closed)return;closed=true;}owner.release(ticket);}
    }
}
