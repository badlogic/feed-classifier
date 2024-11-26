import { Jetstream } from "@skyware/jetstream";
import { spawn } from "child_process";
import * as readline from "readline";
import { cleanText } from "./data";

class FastTextClassifier {
    private process;
    private rl;
    private ready: boolean = false;
    private queue: { text: string; resolve: Function }[] = [];

    constructor() {
        // Start fasttext in interactive mode
        this.process = spawn("fasttext", ["predict-prob", "data/model.bin", "-", "1"]);
        this.rl = readline.createInterface({
            input: this.process.stdout,
            crlfDelay: Infinity,
        });

        // Handle each line of output
        this.rl.on("line", (line) => {
            if (this.queue.length > 0) {
                const { resolve } = this.queue.shift()!;
                const [label, confidence] = line.split(" ");
                resolve({ label, confidence: parseFloat(confidence) });
            }
        });

        this.ready = true;
        this.processQueue();
    }

    async classify(text: string): Promise<{ label: string; confidence: number }> {
        return new Promise((resolve) => {
            this.queue.push({ text, resolve });
            this.processQueue();
        });
    }

    private processQueue() {
        if (!this.ready || this.queue.length === 0) return;

        const { text } = this.queue[0];
        this.process.stdin.write(text + "\n");
    }

    close() {
        this.process.kill();
    }
}

async function main() {
    const classifier = new FastTextClassifier();
    const jetstream = new Jetstream();

    jetstream.onCreate("app.bsky.feed.post", async (event) => {
        const record = event.commit.record as any;
        if (record.text && !record.reply) {
            const post = {
                author: event.did,
                text: record.text,
                createdAt: record.createdAt,
                uri: `at://${event.did}/app.bsky.feed.post/${event.commit.rkey}`,
                cid: event.commit.cid,
                isReply: record.reply != undefined,
            };

            if (post.text.includes("#badbadbad")) {
                console.log("bad");
            }

            const startTime = process.hrtime();
            const cleanedText = cleanText(post.text);
            const prediction = await classifier.classify(cleanedText);
            const [seconds, nanoseconds] = process.hrtime(startTime);
            const classificationTime = seconds * 1000 + nanoseconds / 1000000;

            if (prediction.label == "__label__progamming" && prediction.confidence > 0.7) {
                console.log({
                    created: post.createdAt,
                    author: post.author,
                    text: post.text,
                    classificationTime: `${classificationTime.toFixed(2)}ms`,
                    confidence: prediction.confidence.toFixed(3),
                });
            }
        }
    });

    jetstream.on("error", (error: Error, cursor) => {
        console.error("Firehose interrupted, retrying in 5 seconds", error);
        classifier.close();
        jetstream.close();
    });

    jetstream.start();
}

main().catch(console.error);
