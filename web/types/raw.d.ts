/// <reference types="vite/client" />

declare module '*.pgn?raw' {
  const content: string;
  export default content;
}

declare module '*.js?url' {
  const url: string;
  export default url;
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}
