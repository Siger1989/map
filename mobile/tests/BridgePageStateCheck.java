package com.guanyun.weather;

import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.lang.reflect.Modifier;

/** Compiles and exercises the production page trust state without Android. */
public final class BridgePageStateCheck {
    private static final String START = "https://appassets.androidplatform.net/index.html";
    private static final String STOP = "__STOP__";

    public static void main(String[] args) throws Exception {
        BridgePageState state = new BridgePageState();
        checkVolatile("trusted");
        checkVolatile("foreground");
        BlockingQueue<String> requests = new LinkedBlockingQueue<>();
        BlockingQueue<Boolean> replies = new LinkedBlockingQueue<>();
        Thread bridge = new Thread(() -> {
            try {
                while (!STOP.equals(requests.take())) replies.put(state.trustedForeground());
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
        }, "JavaBridge-page-state-check");
        bridge.start();

        try {
            expect(state, requests, replies, false, "initial state is untrusted and backgrounded");

            state.page(START);
            expect(state, requests, replies, false, "trusted page while backgrounded is not bridge-trusted");
            state.foreground(true);
            expect(state, requests, replies, true, "exact start page in foreground is trusted");

            state.page(START + "#map");
            expect(state, requests, replies, true, "fragment on exact start page remains trusted");
            state.page(START + "?mode=map#view");
            expect(state, requests, replies, true, "query suffix on exact start page remains trusted");

            String[] rejected = {
                "http://appassets.androidplatform.net/index.html",
                "https://appassets.androidplatform.net.evil/index.html",
                "https://evil@appassets.androidplatform.net/index.html",
                "https://appassets.androidplatform.net:443/index.html",
                "https://appassets.androidplatform.net/other.html",
                START + "/subpath",
                START + ".evil",
                "https://appassets.androidplatform.net/other/index.html"
            };
            for (String url : rejected) {
                state.page(url);
                expect(state, requests, replies, false, "untrusted URL rejected: " + url);
            }

            state.page(START);
            expect(state, requests, replies, true, "trusted navigation restores trust in foreground");
            state.foreground(false);
            expect(state, requests, replies, false, "pause immediately removes foreground trust");
            state.page("https://example.org/");
            state.foreground(true);
            expect(state, requests, replies, false, "resume on untrusted page remains blocked");
            state.page(START);
            expect(state, requests, replies, true, "resume after trusted navigation restores bridge access");

            state.foreground(false);
            state.page(null);
            state.foreground(true);
            expect(state, requests, replies, false, "destroyed/null page remains untrusted after any foreground update");
            System.out.println("BridgePageState JavaBridge-thread checks passed");
        } finally {
            requests.put(STOP);
            bridge.join(5000);
            if (bridge.isAlive()) throw new AssertionError("JavaBridge reader thread did not stop");
        }
    }

    private static void checkVolatile(String name) throws Exception {
        int modifiers = BridgePageState.class.getDeclaredField(name).getModifiers();
        if (!Modifier.isVolatile(modifiers)) throw new AssertionError(name + " state is not volatile");
    }

    private static void expect(BridgePageState state, BlockingQueue<String> requests,
                               BlockingQueue<Boolean> replies, boolean expected, String label) throws Exception {
        requests.put(label);
        Boolean actual = replies.poll(5, java.util.concurrent.TimeUnit.SECONDS);
        if (actual == null || actual != expected || state.trustedForeground() != expected) {
            throw new AssertionError(label + ": bridge thread read " + actual + ", direct read " + state.trustedForeground() + ", expected " + expected);
        }
    }
}
