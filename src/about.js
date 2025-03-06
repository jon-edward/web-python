import "./style.css";

const enterTriggerable = document.getElementsByClassName(
  "enter-key-triggerable"
);
for (const elem of enterTriggerable) {
  elem.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.target.click();
    }
  });
}
