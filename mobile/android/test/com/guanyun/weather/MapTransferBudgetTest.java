package com.guanyun.weather;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Pure JVM tests for shared map-priority request slots. */
public final class MapTransferBudgetTest {
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    private static void await(Check check,String message)throws Exception{long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(!check.ok()&&System.nanoTime()<until)Thread.sleep(2);check(check.ok(),message);}
    private interface Check {boolean ok();}
    private static Thread request(MapTransferBudget budget,MapTransferBudget.Kind kind,AtomicReference<MapTransferBudget.Lease> lease,AtomicReference<Throwable> failure,CountDownLatch acquired){
        return new Thread(()->{MapTransferBudget.Ticket ticket=budget.ticket(kind);try{MapTransferBudget.Lease value=budget.acquire(ticket);lease.set(value);acquired.countDown();}catch(Throwable error){failure.set(error);acquired.countDown();}});
    }
    private static void runScenario(int mapLimit)throws Exception{
        int totalLimit=mapLimit+16;
        MapTransferBudget budget=new MapTransferBudget(totalLimit,mapLimit,16,4);
        List<MapTransferBudget.Lease> offline=new ArrayList<>();for(int i=0;i<16;i++)offline.add(budget.acquire(budget.ticket(MapTransferBudget.Kind.OFFLINE)));
        AtomicReference<MapTransferBudget.Lease> waitingOfflineLease=new AtomicReference<>(),mapLease=new AtomicReference<>(),secondOfflineLease=new AtomicReference<>();
        AtomicReference<Throwable> waitingFailure=new AtomicReference<>(),mapFailure=new AtomicReference<>(),secondFailure=new AtomicReference<>();
        CountDownLatch offlineAcquired=new CountDownLatch(1),mapAcquired=new CountDownLatch(1),secondAcquired=new CountDownLatch(1);
        Thread waitingOffline=request(budget,MapTransferBudget.Kind.OFFLINE,waitingOfflineLease,waitingFailure,offlineAcquired);waitingOffline.start();await(()->budget.waitingOffline()==1,"offline wait is tracked");
        Thread map=request(budget,MapTransferBudget.Kind.MAP,mapLease,mapFailure,mapAcquired);map.start();check(mapAcquired.await(3,TimeUnit.SECONDS),"map enters while offline is saturated");
        check(budget.activeMap()==1&&budget.activeOffline()==16,"map and offline share the total cap without starving map");
        Thread secondOffline=request(budget,MapTransferBudget.Kind.OFFLINE,secondOfflineLease,secondFailure,secondAcquired);secondOffline.start();await(()->budget.waitingOffline()==2,"offline wait remains queued");
        for(int i=0;i<12;i++)offline.get(i).close();await(()->budget.activeOffline()==4,"existing offline requests drain to four");
        check(secondAcquired.getCount()==1&&offlineAcquired.getCount()==1,"offline does not exceed four while map is active");
        offline.get(12).close();check(offlineAcquired.await(3,TimeUnit.SECONDS),"queued offline resumes below four");
        check(budget.activeOffline()==4,"offline replenishes only to four during map traffic");
        mapLease.get().close();check(secondAcquired.await(3,TimeUnit.SECONDS),"offline ceiling restores when map leaves");
        check(budget.activeOffline()==5&&budget.activeMap()==0,"offline returns to bulk ceiling after map work");
        waitingOfflineLease.get().close();secondOfflineLease.get().close();for(int i=13;i<16;i++)offline.get(i).close();
        await(()->budget.activeOffline()==0,"offline leases release");

        List<MapTransferBudget.Lease> maps=new ArrayList<>();for(int i=0;i<mapLimit;i++)maps.add(budget.acquire(budget.ticket(MapTransferBudget.Kind.MAP)));
        MapTransferBudget.Ticket cancelled=budget.ticket(MapTransferBudget.Kind.MAP);AtomicReference<Throwable> cancelFailure=new AtomicReference<>();CountDownLatch cancelledDone=new CountDownLatch(1);
        Thread waiter=new Thread(()->{try{budget.acquire(cancelled);}catch(Throwable error){cancelFailure.set(error);}finally{cancelledDone.countDown();}});waiter.start();await(()->budget.waitingMap()==1,"map waiter queued");cancelled.cancel();check(cancelledDone.await(3,TimeUnit.SECONDS),"cancel wakes queued request promptly");check(cancelFailure.get()!=null&&budget.waitingMap()==0,"cancelled waiter leaves no queue slot");
        for(MapTransferBudget.Lease lease:maps)lease.close();await(()->budget.activeMap()==0,"map leases release");
        MapTransferBudget saturated=new MapTransferBudget(totalLimit,mapLimit,16,4);List<MapTransferBudget.Lease> fullMaps=new ArrayList<>(),fullOffline=new ArrayList<>();
        for(int i=0;i<16;i++)fullOffline.add(saturated.acquire(saturated.ticket(MapTransferBudget.Kind.OFFLINE)));
        for(int i=0;i<mapLimit;i++)fullMaps.add(saturated.acquire(saturated.ticket(MapTransferBudget.Kind.MAP)));
        AtomicReference<MapTransferBudget.Lease> priorityMapLease=new AtomicReference<>();AtomicReference<Throwable> priorityFailure=new AtomicReference<>();CountDownLatch priorityAcquired=new CountDownLatch(1);
        Thread priorityMap=request(saturated,MapTransferBudget.Kind.MAP,priorityMapLease,priorityFailure,priorityAcquired);priorityMap.start();await(()->saturated.waitingMap()==1,"map queues at global cap");
        MapTransferBudget.Ticket queuedOffline=saturated.ticket(MapTransferBudget.Kind.OFFLINE);CountDownLatch offlineCancelled=new CountDownLatch(1);AtomicReference<Throwable> offlineFailure=new AtomicReference<>();
        Thread offlineWaiter=new Thread(()->{try{saturated.acquire(queuedOffline);}catch(Throwable error){offlineFailure.set(error);}finally{offlineCancelled.countDown();}});offlineWaiter.start();await(()->saturated.waitingOffline()==1,"offline queues behind map");
        fullMaps.get(0).close();check(priorityAcquired.await(3,TimeUnit.SECONDS),"queued map wins the next released slot");check(priorityMapLease.get()!=null&&saturated.activeMap()+saturated.activeOffline()==totalLimit,"global network cap remains map plus 16 offline slots");
        check(offlineCancelled.getCount()==1,"queued offline cannot take a slot ahead of map");queuedOffline.cancel();check(offlineCancelled.await(3,TimeUnit.SECONDS)&&offlineFailure.get()!=null,"queued offline cancellation wakes immediately");
        priorityMapLease.get().close();for(MapTransferBudget.Lease lease:fullMaps)lease.close();for(MapTransferBudget.Lease lease:fullOffline)lease.close();
        await(()->saturated.activeMap()==0&&saturated.activeOffline()==0,"saturated budget releases every lease");
        MapTransferBudget guarded=new MapTransferBudget(totalLimit,mapLimit,16,4);MapTransferBudget.Ticket single=guarded.ticket(MapTransferBudget.Kind.MAP);MapTransferBudget.Lease once=guarded.acquire(single);
        try{guarded.acquire(single);throw new AssertionError("ticket acquired twice");}catch(java.io.IOException expected){}
        check(guarded.activeMap()==1,"duplicate acquire does not inflate active count");once.close();once.close();check(guarded.activeMap()==0,"lease close is idempotent");
    }
    public static void main(String[] args)throws Exception{
        runScenario(8);
        runScenario(16);
        System.out.println("MapTransferBudgetTest PASS (map limits 8 and 16)");
    }
}
