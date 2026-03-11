import React from "react";
import ReactDOM from "react-dom";

const withMouse = Component => {
  return class extends React.Component {
    state = { x: 0, y: 0 };

    handleMouseMove = event => {
      this.setState({
        x: event.clientX,
        y: event.clientY
      });
    };

    render() {
      return (
        <div style={{ height: "100%" }} onMouseMove={this.handleMouseMove}>
          <Component {...this.props} mouse={this.state} />
        </div>
      );
    }
  };
};

const App = React.createClass({
  render() {
    // 现在，我们得到了一个鼠标位置的 prop，而不再需要维护自己的 state
    const { x, y } = this.props.mouse;
    return (
      <div style={{ height: "100%" }}>
        <h1>
          The mouse position is ({x}, {y})
        </h1>
      </div>
    );
  }
});

//需要用 withMouse 包裹组件，它就能获得 mouse prop
const AppWithMouse = withMouse(App);
ReactDOM.render(<AppWithMouse />, document.getElementById("app"));
