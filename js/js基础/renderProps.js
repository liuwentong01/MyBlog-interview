//一个 render prop 是一个类型为函数的 prop，它让组件知道该渲染什么。
//不同于通过 “混入” 或者装饰来共享组件行为，一个普通组件只需要一个函数 prop 就能够进行一些 state 共享。
import React from "react";
import ReactDOM from "react-dom";
import PropTypes from "prop-types";

class Mouse extends React.Component {
  static propTypes = {
    render: PropTypes.func.isRequired
  };
  constructor(){
    this.state = { x: 0, y: 0 };
  }

  handleMouseMove = event => {
    this.setState({
      x: event.clientX,
      y: event.clientY
    });
  };

  render() {
    return (
      <div style={{ height: "100%" }} onMouseMove={this.handleMouseMove}>
        {this.props.render(this.state)}
      </div>
    );
  }
}

const App = React.createClass({
  render() {
    return (
      <div style={{ height: "100%" }}>
        <Mouse
          render={({ x, y }) => (
            // render prop 给了我们所需要的 state 来渲染我们想要的
            <h1>
              The mouse position is ({x}, {y})
            </h1>
          )}
        />
      </div>
    );
  }
});

ReactDOM.render(<App />, document.getElementById("app"));
