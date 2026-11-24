/** Generic Binary Min-Heap for A*, Dijkstra, and Prim's MST */
export class MinHeap<T> {
  private readonly items: { priority: number; value: T }[] = [];

  public get size(): number {
    return this.items.length;
  }

  public push(priority: number, value: T): void {
    this.items.push({ priority, value });
    this.bubbleUp(this.items.length - 1);
  }

  public pop(): { priority: number; value: T } | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.items[parent].priority <= this.items[idx].priority) break;
      const tmp = this.items[parent];
      this.items[parent] = this.items[idx];
      this.items[idx] = tmp;
      idx = parent;
    }
  }

  private sinkDown(idx: number): void {
    const n = this.items.length;
    while (true) {
      let smallest = idx;
      const l = idx * 2 + 1;
      const r = idx * 2 + 2;
      if (l < n && this.items[l].priority < this.items[smallest].priority) smallest = l;
      if (r < n && this.items[r].priority < this.items[smallest].priority) smallest = r;
      if (smallest === idx) break;
      const tmp = this.items[smallest];
      this.items[smallest] = this.items[idx];
      this.items[idx] = tmp;
      idx = smallest;
    }
  }
}
