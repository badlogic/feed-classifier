export type Post = {
    author: string;
    text: string;
    createdAt: string;
    uri: string;
    cid: string;
    isReply: boolean;
};

export type Sample = {
    post: Post;
    label: string;
};

export function cleanText(text: string): string {
    return (
        text
            .replace(/\n/g, " ")
            .replace(/\s+/g, " ")

            .replace(/https?:\/\/\S+/g, "")
            .replace(/github\.com\/\S+/g, "")
            .replace(/gist\.github\.com\/\S+/g, "")
            // .replace(/http\S+/g, "")
            // .replaceAll("github.com", "")

            .trim()
    );
}

export const shuffle = <T>(array: T[]): T[] => array.sort(() => Math.random() - 0.5);
