import { Jetstream } from "@skyware/jetstream";
import { execSync } from "child_process";
import * as fs from "fs";
import { cleanText, Post, Sample, shuffle } from "./data";

async function fetchFeed(feedName: string) {
    const resp = await fetch(`https://progfeeds.mariozechner.at/api/download?feed=${feedName}`);
    if (!resp.ok) {
        console.error("Could not download githubrepos feed");
        process.exit(-1);
    }
    const feed = (await resp.text())
        .split("\n")
        .filter((line) => line.trim().length != 0)
        .map((line) => JSON.parse(line) as Post);
    return feed;
}

function fetchFirehose(numPosts: number): Promise<Post[]> {
    const posts: Post[] = [];
    const jetstream = new Jetstream();

    return new Promise((resolve, reject) => {
        jetstream.onCreate("app.bsky.feed.post", (event) => {
            const record = event.commit.record as any;
            if (record.text && !record.text.includes("github.com")) {
                posts.push({
                    author: event.did,
                    text: record.text,
                    createdAt: record.createdAt,
                    uri: `at://${event.did}/app.bsky.feed.post/${event.commit.rkey}`,
                    cid: event.commit.cid,
                    isReply: record.reply != undefined,
                });
                if (posts.length == numPosts) {
                    jetstream.close();
                    resolve(posts);
                }
                if (posts.length % 100 == 0) {
                    console.log(`${posts.length}/${numPosts}`);
                }
            }
        });

        jetstream.on("error", (error: Error, cursor) => {
            console.error("Firehose interrupted, retrying in 5 seconds", error);
            jetstream.close();
            reject(error);
        });

        jetstream.start();
    });
}

async function createTrainingset() {
    const githubPosts: Sample[] = (await fetchFeed("githubrepos")).map((post) => {
        return { post, label: "__progamming" };
    });
    console.log(`Fetched ${githubPosts.length} githubrepos posts`);
    const firehosePosts: Sample[] = (await fetchFirehose(githubPosts.length)).map((post) => {
        return { post, label: "__other" };
    });
    console.log(`Fetched ${firehosePosts.length} firehose posts`);

    const combined = [...githubPosts, ...firehosePosts];
    shuffle(combined);
    fs.writeFileSync("data/train.json", JSON.stringify(combined, null, 2));
}

function prepareFastTextData(samples: Sample[], testSplit: number = 0.2) {
    const shuffled = [...samples];
    const testSize = Math.floor(samples.length * testSplit);
    const testData = shuffled.slice(0, testSize);
    const trainData = shuffled.slice(testSize);

    const convertToFastTextFormat = (samples: Sample[]): string => {
        return samples
            .map((sample) => {
                const fastTextLabel = `__label__${sample.label.replace("__", "")}`;
                return `${fastTextLabel} ${cleanText(sample.post.text)}`;
            })
            .join("\n");
    };

    fs.writeFileSync("data/train.txt", convertToFastTextFormat(trainData));
    fs.writeFileSync("data/test.txt", convertToFastTextFormat(testData));

    console.log(`Created training file with ${trainData.length} samples`);
    console.log(`Created test file with ${testData.length} samples`);
}

function trainFastTextModel() {
    try {
        execSync(
            "fasttext supervised \
            -input data/train.txt \
            -output data/model \
            -dim 100 \
            -epoch 50 \
            -lr 0.8 \
            -wordNgrams 2 \
            -minn 3 \
            -maxn 6 \
            -ws 10"
        );

        console.log("Model trained and saved to data/model.bin");

        const testOutput = execSync("fasttext test data/model.bin data/test.txt").toString();
        console.log("Test results:", testOutput);

        analyzeMisclassifications();
    } catch (error) {
        console.error("Error training model:", error);
        process.exit(1);
    }
}

function analyzeMisclassifications() {
    try {
        const testLines = fs
            .readFileSync("data/test.txt", "utf-8")
            .split("\n")
            .filter((l) => l.trim());
        const predictions = execSync("fasttext predict-prob data/model.bin data/test.txt 2").toString().split("\n");

        const errors: string[] = [];

        testLines.forEach((line, i) => {
            if (!line || !predictions[i]) return;

            const actualLabel = line.split(" ")[0];
            const prediction = predictions[i].split(" ")[0];

            if (actualLabel !== prediction) {
                const confidence = predictions[i].split(" ")[1];
                errors.push(
                    `Actual: ${actualLabel}\nPredicted: ${prediction} (conf: ${confidence})\nText: ${line.slice(
                        line.indexOf(" ") + 1
                    )}\n---\n`
                );
            }
        });

        fs.writeFileSync("data/errors.txt", errors.join("\n"));
        console.log(`Wrote ${errors.length} misclassifications to data/errors.txt`);
    } catch (error) {
        console.error("Error analyzing misclassifications:", error);
    }
}

async function main() {
    if (!fs.existsSync("data")) {
        fs.mkdirSync("data");
    }

    if (!fs.existsSync("data/train.json")) {
        await createTrainingset();
    }

    const training = JSON.parse(fs.readFileSync("data/train.json", "utf-8")) as Sample[];
    console.log(`Training samples: ${training.length}`);

    prepareFastTextData(training);
    trainFastTextModel();
}

main();
