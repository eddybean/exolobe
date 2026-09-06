/**
 * sherpa-onnx は N-API のネイティブアドオンで型定義を同梱していない。
 * このアプリで使う範囲だけを宣言し、アダプタ内で unknown から絞り込む。
 */
declare module 'sherpa-onnx'
