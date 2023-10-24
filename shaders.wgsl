struct VertexInput {
  @location(0) pos : vec2f,
  @builtin(instance_index) instance : u32,
}

struct VertexOutput {
  @builtin(position) pos : vec4f,
  @location(0) cell : vec2f,
}

@group(0) @binding(0) var<uniform> grid : vec2f;
@group(0) @binding(1) var<storage> cellState: array<u32>;

@vertex
fn vertexMain(input : VertexInput) -> VertexOutput {

  let index = f32(input.instance);
  let cell = vec2f(index % grid.x, floor(index / grid.x));
  let state = f32(cellState[input.instance]);

  let cellOffset = cell / grid * 2;
  let scaledPos = input.pos * state + 1;
  let gridPos = scaledPos / grid - 1 + cellOffset;

  var output : VertexOutput;
  output.pos = vec4f(gridPos, 0, 1);
  output.cell = cell;

  return output;
}

@fragment
fn fragmentMain(input : VertexOutput) -> @location(0) vec4f {
  let channel = input.cell / grid;
  let blue = 1 - channel.x;

  return vec4f(channel, blue, 1);
}
