import { UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";

type LouvainFn = (graph: InstanceType<typeof UndirectedGraph>, options?: { resolution?: number }) => Record<string, number>;

const runLouvain = louvain as unknown as LouvainFn;

const g = new UndirectedGraph();
const m = runLouvain(g, { resolution: 1.0 });
console.log(m);
